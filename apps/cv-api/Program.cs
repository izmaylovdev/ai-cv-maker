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

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = false,
            ValidateAudience = false,
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization();

// CORS
builder.Services.AddCors(opt =>
    opt.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod()));

// Tracing
builder.Services.AddScoped<TraceContext>();

// Services
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPdfService, PdfService>();
builder.Services.AddGrpcClient<CvApi.Grpc.LlmService.LlmServiceClient>(o =>
{
    o.Address = new Uri(builder.Configuration["LlmService:GrpcUrl"] ?? "http://localhost:50051");
});

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

var app = builder.Build();

// Apply pending migrations on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
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
