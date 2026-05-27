using CvApi.Features.JobProfiles.Dtos;
using Microsoft.AspNetCore.Http;

namespace CvApi.Features.JobProfiles;

public interface IJobProfileService
{
    Task<List<JobProfileListItemDto>> ListAsync(Guid userId);
    Task<JobProfileListItemDto> CreateAsync(Guid userId, CreateJobProfileRequest request);
    Task<ProfileDto?> GetAsync(Guid id, Guid userId);
    Task<ProfileDto?> UpdateAsync(Guid id, Guid userId, UpdateProfileRequest request);
    Task<bool> DeleteAsync(Guid id, Guid userId);
    Task<OptimizeProfileResponse?> OptimizeAsync(Guid id, Guid userId, OptimizeProfileRequest request);
    Task<UpdateProfileRequest?> ExtractAsync(Guid id, Guid userId, IFormFile file);
    Task<ChatResponse?> ChatAsync(Guid id, Guid userId, ChatRequest request);
}
