using System.Diagnostics;
using CvApi.Domain.Entities;
using CvApi.Grpc;
using CvApi.Infrastructure.Services;

namespace CvApi.Infrastructure.ExternalServices.Llm;

public class LlmService(CvApi.Grpc.LlmService.LlmServiceClient grpcClient, TraceContext trace) : ILlmService
{
    private void AddSpan(string operation, bool isError, long durationMs, DateTime startedAt) =>
        trace.PendingSpans.Add(new RequestSpan
        {
            TraceId = trace.TraceId,
            Service = "cv-api",
            SpanKind = "grpc",
            Operation = operation,
            IsError = isError,
            DurationMs = (int)durationMs,
            StartedAt = startedAt,
        });

    public async Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var reply = await grpcClient.GenerateAsync(new GenerateRequest
            {
                Profile = MapProfile(request.Profile),
                Message = request.Message ?? string.Empty,
            });

            AddSpan("LlmService/Generate", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmGenerateResponse(
                reply.Summary,
                reply.WorkExperiences.Select(w => new LlmWorkExperience(w.Company, w.Role, w.Period, w.Description)).ToList(),
                reply.Educations.Select(e => new LlmEducation(e.Institution, e.Degree, e.Field, e.Period)).ToList(),
                reply.Skills.ToList(),
                reply.Highlights.ToList()
            );
        }
        catch
        {
            AddSpan("LlmService/Generate", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmOptimizeResponse> OptimizeAsync(LlmOptimizeRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var reply = await grpcClient.OptimizeAsync(new OptimizeRequest
            {
                Profile = MapProfile(request.Profile),
                Message = request.Message,
            });

            AddSpan("LlmService/Optimize", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmOptimizeResponse(
                reply.Title,
                reply.Overview,
                reply.WorkExperiences.Select(w => new LlmOptimizeWorkExperience(
                    w.Company, w.Role, w.StartDate, string.IsNullOrEmpty(w.EndDate) ? null : w.EndDate, w.Description
                )).ToList(),
                reply.Skills.Select(s => new LlmOptimizeSkill(s.Name)).ToList()
            );
        }
        catch
        {
            AddSpan("LlmService/Optimize", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var reply = await grpcClient.ExtractProfileAsync(new ExtractProfileRequest
            {
                CvText = request.CvText,
            });

            AddSpan("LlmService/ExtractProfile", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmExtractResponse(
                reply.FullName,
                reply.Title,
                reply.Overview,
                string.IsNullOrEmpty(reply.Location) ? null : reply.Location,
                string.IsNullOrEmpty(reply.ContactEmail) ? null : reply.ContactEmail,
                string.IsNullOrEmpty(reply.ContactPhone) ? null : reply.ContactPhone,
                reply.WorkExperiences.Select(w => new LlmExtractWorkExperience(
                    w.Company, w.Role, w.StartDate,
                    string.IsNullOrEmpty(w.EndDate) ? null : w.EndDate,
                    w.Description
                )).ToList(),
                reply.Educations.Select(e => new LlmExtractEducation(
                    e.Institution, e.Degree, e.Field, e.StartYear,
                    e.EndYear == 0 ? null : e.EndYear
                )).ToList(),
                reply.Skills.Select(s => new LlmExtractSkill(s.Name)).ToList()
            );
        }
        catch
        {
            AddSpan("LlmService/ExtractProfile", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmEnhanceFieldResponse> EnhanceFieldAsync(LlmEnhanceFieldRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var reply = await grpcClient.EnhanceFieldAsync(new CvApi.Grpc.EnhanceFieldRequest
            {
                Content = request.Content,
                FieldPurpose = request.FieldPurpose,
            });

            AddSpan("LlmService/EnhanceField", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmEnhanceFieldResponse(reply.Enhanced);
        }
        catch
        {
            AddSpan("LlmService/EnhanceField", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmChatResponse> ChatAsync(LlmChatRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var grpcRequest = new CvApi.Grpc.ChatRequest
            {
                Profile = MapProfile(request.Profile),
                Message = request.Message,
            };
            grpcRequest.History.AddRange(request.History.Select(h => new CvApi.Grpc.ChatMessage
            {
                Role = h.Role,
                Content = h.Content,
            }));

            var reply = await grpcClient.ChatAsync(grpcRequest);

            AddSpan("LlmService/Chat", false, sw.ElapsedMilliseconds, startedAt);

            LlmChatProposal? proposal = null;
            if (!string.IsNullOrEmpty(reply.Proposal?.Type))
            {
                proposal = new LlmChatProposal(
                    reply.Proposal.Type,
                    reply.Proposal.Description,
                    reply.Proposal.PatchJson
                );
            }

            return new LlmChatResponse(reply.Reply, proposal);
        }
        catch
        {
            AddSpan("LlmService/Chat", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmUserChatResponse> UserChatAsync(LlmUserChatRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var grpcRequest = new CvApi.Grpc.UserChatRequest
            {
                Message = request.Message,
            };
            grpcRequest.Profiles.AddRange(request.Profiles.Select(p => new CvApi.Grpc.ProfileSummary
            {
                Name = p.Name,
                Title = p.Title,
                Overview = p.Overview,
                Skills = { p.Skills },
            }));
            grpcRequest.History.AddRange(request.History.Select(h => new CvApi.Grpc.ChatMessage
            {
                Role = h.Role,
                Content = h.Content,
            }));

            var reply = await grpcClient.UserChatAsync(grpcRequest);

            AddSpan("LlmService/UserChat", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmUserChatResponse(reply.Reply);
        }
        catch
        {
            AddSpan("LlmService/UserChat", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmCoverLetterResponse> GenerateCoverLetterAsync(LlmCoverLetterRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var grpcRequest = new CvApi.Grpc.CoverLetterRequest
            {
                JobTitle = request.JobTitle,
                JobDescription = request.JobDescription,
                FieldContext = request.FieldContext,
            };
            foreach (var p in request.Profiles)
            {
                grpcRequest.ProfileIds.Add(p.Id);
                grpcRequest.Profiles.Add(MapProfileFromCoverLetter(p));
            }

            var reply = await grpcClient.GenerateCoverLetterAsync(grpcRequest);

            AddSpan("LlmService/GenerateCoverLetter", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmCoverLetterResponse(
                reply.Text,
                Guid.TryParse(reply.SelectedProfileId, out var id) ? id : Guid.Empty
            );
        }
        catch
        {
            AddSpan("LlmService/GenerateCoverLetter", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    private static ProfileInput MapProfileFromCoverLetter(LlmCoverLetterProfile p) => new()
    {
        FullName = p.FullName,
        Title = p.Title,
        Overview = p.Overview,
        Location = p.Location ?? string.Empty,
        WorkExperiences =
        {
            p.WorkExperiences.Select(w => new WorkExperienceInput
            {
                Id = w.Id?.ToString() ?? string.Empty,
                Company = w.Company,
                Role = w.Role,
                StartDate = w.StartDate.ToString(),
                EndDate = w.EndDate?.ToString() ?? string.Empty,
                Description = w.Description,
            })
        },
        Educations =
        {
            p.Educations.Select(e => new EducationInput
            {
                Id = e.Id?.ToString() ?? string.Empty,
                Institution = e.Institution,
                Degree = e.Degree,
                Field = e.Field,
                StartYear = e.StartYear,
                EndYear = e.EndYear ?? 0,
            })
        },
        Skills =
        {
            p.Skills.Select(s => new SkillInput
            {
                Id = s.Id?.ToString() ?? string.Empty,
                Name = s.Name,
            })
        },
    };

    private static ProfileInput MapProfile(LlmProfileRequest p) => new()
    {
        FullName = p.FullName,
        Title = p.Title,
        Overview = p.Overview,
        Location = p.Location ?? string.Empty,
        WorkExperiences =
        {
            p.WorkExperiences.Select(w => new WorkExperienceInput
            {
                Id = w.Id?.ToString() ?? string.Empty,
                Company = w.Company,
                Role = w.Role,
                StartDate = w.StartDate.ToString(),
                EndDate = w.EndDate?.ToString() ?? string.Empty,
                Description = w.Description,
            })
        },
        Educations =
        {
            p.Educations.Select(e => new EducationInput
            {
                Id = e.Id?.ToString() ?? string.Empty,
                Institution = e.Institution,
                Degree = e.Degree,
                Field = e.Field,
                StartYear = e.StartYear,
                EndYear = e.EndYear ?? 0,
            })
        },
        Skills =
        {
            p.Skills.Select(s => new SkillInput
            {
                Id = s.Id?.ToString() ?? string.Empty,
                Name = s.Name,
            })
        },
    };
}
