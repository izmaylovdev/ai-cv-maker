using System.Text;
using CvApi.Features.Auth;
using CvApi.Features.CoverLetter;
using CvApi.Features.Cvs;
using CvApi.Features.JobProfiles;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.ExternalServices.Pdf;
using CvApi.Infrastructure.Json;
using CvApi.Infrastructure.Persistence.Firestore;
using Grpc.Core;
// Disambiguate from OpenTelemetry.Trace.StatusCode pulled in by the tracing setup.
using StatusCode = Grpc.Core.StatusCode;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using OpenTelemetry;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Polly;
using Polly.CircuitBreaker;
using Prometheus;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;

// There is no `migrate` CLI mode and no startup migration: Firestore is
// schemaless, so ADR-0003's migration-as-a-deploy-step no longer applies to
// cv-api and the cv-api-migrate Cloud Run job is gone (ADR-0021).

var builder = WebApplication.CreateBuilder(args);
// Local-dev secrets come from .NET User Secrets, which WebApplication.CreateBuilder
// auto-loads only in the Development environment and never in a deployed image
// (so they can't override Secret Manager). Seed them with
// scripts/load-cv-api-secrets.sh. Env vars / Secret Manager win in deployed envs.

builder.Services.AddControllers()
    .AddJsonOptions(opt =>
    {
        opt.JsonSerializerOptions.Converters.Add(new LenientDateOnlyConverter());
        opt.JsonSerializerOptions.Converters.Add(new LenientNullableDateOnlyConverter());
    });
builder.Services.AddHealthChecks();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "CV API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            []
        }
    });
});

// JWT Auth
var jwtSecret = builder.Configuration["JwtSettings:Secret"]
    ?? throw new InvalidOperationException("JwtSettings:Secret is not configured");
var jwtIssuer = builder.Configuration["JwtSettings:Issuer"] ?? "cv-api";
var jwtAudience = builder.Configuration["JwtSettings:Audience"] ?? "cv-app";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization();

// CORS
// AllowAnyOrigin cannot be combined with AllowCredentials (required for cookies).
// Explicit origins are used so the browser sends the refresh_token HttpOnly cookie.
var allowedOrigins = (builder.Configuration["Cors:AllowedOrigins"] ?? "http://localhost:4200")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(opt =>
    opt.AddDefaultPolicy(policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()));

// Distributed tracing to Tempo via OpenTelemetry (ADR-0016). Gated on
// OTEL_EXPORTER_OTLP_ENDPOINT: with no endpoint the exporter is not registered,
// so tracing is a no-op (plain local dev, CI and tests are unaffected). The
// gRPC client instrumentation injects W3C traceparent into call metadata, so the
// trace propagates to llm-service automatically.
if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
{
    builder.Services.AddOpenTelemetry()
        .ConfigureResource(r => r.AddService(
            builder.Configuration["OTEL_SERVICE_NAME"] ?? "cv-api"))
        .WithTracing(t => t
            .AddAspNetCoreInstrumentation()
            .AddGrpcClientInstrumentation()
            .AddOtlpExporter());
}

// Needed by LlmService to read the authenticated user id for Langfuse trace
// context propagated to llm-service (ADR-0010).
builder.Services.AddHttpContextAccessor();

// Services
// ADR-0021 persistence seam, backed by Firestore — the only implementation.
builder.Services.AddFirestorePersistence(builder.Configuration);

builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPdfService, PdfService>();
var llmGrpcUrl = builder.Configuration["LlmService:GrpcUrl"] ?? "http://localhost:50051";
var llmTokenProvider = LlmCallAuth.CreateTokenProvider(
    builder.Configuration["LlmService:AuthMode"], llmGrpcUrl);
builder.Services.AddSingleton(llmTokenProvider);

var llmGrpcClientBuilder = builder.Services.AddGrpcClient<CvApi.Grpc.LlmService.LlmServiceClient>(o =>
{
    o.Address = new Uri(llmGrpcUrl);
});

// Cloud Run only: attach a Google-signed ID token so llm-service's IAM
// (run.invoker restricted to cv-api's service account) accepts the call.
// Local plaintext gRPC must not carry call credentials, so the chain is conditional.
if (llmTokenProvider is not NullLlmCallTokenProvider)
{
    llmGrpcClientBuilder.AddCallCredentials(async (context, metadata, serviceProvider) =>
    {
        var provider = serviceProvider.GetRequiredService<ILlmCallTokenProvider>();
        await LlmCallAuth.ApplyAsync(provider, metadata, context.CancellationToken);
    });
}

// Polly resilience pipeline for LLM gRPC calls:
//   - Retry up to 2 times with exponential backoff on Unavailable / DeadlineExceeded
//   - Circuit breaker: open after 5 consecutive failures, break for 30 seconds
builder.Services.AddResiliencePipeline(LlmService.ResiliencePipelineKey, pipelineBuilder =>
{
    pipelineBuilder
        .AddRetry(new Polly.Retry.RetryStrategyOptions
        {
            MaxRetryAttempts = 2,
            BackoffType = DelayBackoffType.Exponential,
            Delay = TimeSpan.FromSeconds(1),
            ShouldHandle = new PredicateBuilder()
                .Handle<RpcException>(ex =>
                    ex.StatusCode is StatusCode.Unavailable or StatusCode.DeadlineExceeded),
        })
        .AddCircuitBreaker(new Polly.CircuitBreaker.CircuitBreakerStrategyOptions
        {
            FailureRatio = 1.0,          // open after consecutive failures (see MinimumThroughput)
            MinimumThroughput = 5,
            SamplingDuration = TimeSpan.FromSeconds(30),
            BreakDuration = TimeSpan.FromSeconds(30),
            ShouldHandle = new PredicateBuilder()
                .Handle<RpcException>(ex =>
                    ex.StatusCode is StatusCode.Unavailable
                        or StatusCode.DeadlineExceeded
                        or StatusCode.Internal),
        });
});

builder.Services.AddScoped<ILlmService, LlmService>();
builder.Services.AddScoped<IJobProfileService, JobProfileService>();
builder.Services.AddScoped<ICvService, CvService>();
builder.Services.AddScoped<CoverLetterService>();
builder.Services.Configure<CvApi.Features.Usage.LlmPricingOptions>(
    builder.Configuration.GetSection(CvApi.Features.Usage.LlmPricingOptions.SectionName));
builder.Services.Configure<CvApi.Features.Usage.UsageLimitOptions>(
    builder.Configuration.GetSection(CvApi.Features.Usage.UsageLimitOptions.SectionName));
builder.Services.Configure<CvApi.Features.Billing.BillingOptions>(
    builder.Configuration.GetSection(CvApi.Features.Billing.BillingOptions.SectionName));
builder.Services.AddScoped<CvApi.Features.Usage.UsageService>();

// Balance top-ups (US-BILL-1). Which channel implementations are registered is
// decided once at startup: fake-provider mode swaps both real channels for
// local fakes and exposes the /api/billing/fake-pay/* endpoints below.
builder.Services.Configure<CvApi.Features.Billing.PaymentsOptions>(
    builder.Configuration.GetSection(CvApi.Features.Billing.PaymentsOptions.SectionName));
builder.Services.AddHttpClient(); // Monobank invoice + pubkey calls
var useFakePaymentProviders = builder.Configuration.GetValue<bool>("Billing:Payments:UseFakeProviders");
if (useFakePaymentProviders)
{
    builder.Services.AddScoped<CvApi.Features.Billing.Channels.IPaymentChannel,
        CvApi.Features.Billing.Channels.FakeStripeChannel>();
    builder.Services.AddScoped<CvApi.Features.Billing.Channels.IPaymentChannel,
        CvApi.Features.Billing.Channels.FakeMonobankChannel>();
}
else
{
    builder.Services.AddScoped<CvApi.Features.Billing.Channels.IPaymentChannel,
        CvApi.Features.Billing.Channels.StripeChannel>();
    builder.Services.AddScoped<CvApi.Features.Billing.Channels.IPaymentChannel,
        CvApi.Features.Billing.Channels.MonobankChannel>();
}
builder.Services.AddScoped<CvApi.Features.Billing.Channels.PaymentChannelResolver>();
builder.Services.AddScoped<CvApi.Features.Billing.PaymentConfirmationService>();
builder.Services.AddScoped<CvApi.Features.Billing.TopUpService>();
builder.Services.AddSingleton<CvApi.Features.Billing.Channels.MonobankSignatureVerifier>();

// Map the per-user spending-limit guard (US-AI-7) to HTTP 402.
builder.Services.AddExceptionHandler<CvApi.Features.Usage.UsageLimitExceptionHandler>();
// Classify LLM failures into specific { code, message } responses (US-AI-11) so
// the chat widget can show a precise reason instead of a generic error.
builder.Services.AddExceptionHandler<CvApi.Infrastructure.ExternalServices.Llm.LlmInvalidRequestExceptionHandler>();
builder.Services.AddExceptionHandler<CvApi.Infrastructure.ExternalServices.Llm.LlmRateLimitExceptionHandler>();
builder.Services.AddExceptionHandler<CvApi.Infrastructure.ExternalServices.Llm.LlmEditFailedExceptionHandler>();
builder.Services.AddExceptionHandler<CvApi.Infrastructure.ExternalServices.Llm.LlmUnavailableExceptionHandler>();
builder.Services.AddProblemDetails();

// Admin plane (ADR-0005): admin-api reads the user list through this endpoint
// instead of querying the DB directly. Guarded by the shared API key, not JWT.
builder.Services.AddScoped<CvApi.Features.Admin.AdminUsersService>();
builder.Services.AddScoped<CvApi.Features.Admin.AdminApiKeyFilter>();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseExceptionHandler();
app.UseCors();
app.UseMetricServer("/metrics");
app.UseHttpMetrics();
app.UseAuthentication();
app.UseAuthorization();
app.MapHealthChecks("/health");
app.MapControllers();

// Fake payment pages exist only in fake-provider mode (US-BILL-1, F-BILL-1.9);
// with real providers configured these routes must 404.
if (useFakePaymentProviders)
    CvApi.Features.Billing.FakePayEndpoints.MapFakePayEndpoints(app);

app.Run();

// Expose the implicit top-level Program class so WebApplicationFactory<Program>
// can reference it from the test project.
public partial class Program { }
