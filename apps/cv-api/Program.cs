using System.Text;
using CvApi.Features.Auth;
using CvApi.Features.CoverLetter;
using CvApi.Features.Cvs;
using CvApi.Features.JobProfiles;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.ExternalServices.Pdf;
using CvApi.Infrastructure.Json;
using CvApi.Infrastructure.Middleware;
using CvApi.Infrastructure.Persistence;
using CvApi.Infrastructure.Services;
using Grpc.Core;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Polly;
using Polly.CircuitBreaker;
using Prometheus;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;

// CLI mode: `dotnet cv-api.dll migrate` applies EF Core migrations and exits
// (0 on success, non-zero on failure) without starting the web host. Used by
// the cv-api-migrate Cloud Run job so schema changes run exactly once per
// deploy instead of racing across service instances (ADR-0003).
if (args.FirstOrDefault() == "migrate")
{
    var migrateBuilder = Host.CreateApplicationBuilder();
    migrateBuilder.Configuration.AddJsonFile("appsettings.Local.json", optional: true);
    migrateBuilder.Services.AddDbContext<AppDbContext>(opt =>
        opt.UseNpgsql(migrateBuilder.Configuration.GetConnectionString("DefaultConnection")));

    using var migrateHost = migrateBuilder.Build();
    using var migrateScope = migrateHost.Services.CreateScope();
    try
    {
        migrateScope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
        Console.WriteLine("Database migrations applied successfully.");
        return;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Database migration failed: {ex}");
        Environment.Exit(1);
    }
}

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

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

// Database
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

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

// Tracing
builder.Services.AddScoped<TraceContext>();

// Services
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
builder.Services.AddScoped<CvApi.Features.Usage.UsageService>();

var app = builder.Build();

// Local-dev convenience only (docker-compose sets RunMigrationsOnStartup=true).
// Production applies migrations through the `migrate` CLI mode, executed as the
// cv-api-migrate Cloud Run job before the service rolls out (ADR-0003).
if (builder.Configuration.GetValue<bool>("RunMigrationsOnStartup"))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

app.UseSwagger();
app.UseSwaggerUI();

app.UseCors();
app.UseMetricServer("/metrics");
app.UseHttpMetrics();
app.UseMiddleware<RequestTracingMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.MapHealthChecks("/health");
app.MapControllers();

app.Run();
