using CvApi.Features.JobProfiles.Dtos;
using Microsoft.AspNetCore.Http;

namespace CvApi.Features.JobProfiles;

public interface IJobProfileService
{
    Task<List<JobProfileListItemDto>> ListAsync(Guid userId);
    Task<JobProfileListItemDto> CreateAsync(Guid userId, CreateJobProfileRequest request);
    Task<ProfileDto?> GetAsync(Guid id, Guid userId);
    Task<ProfileDto?> UpdateAsync(Guid id, Guid userId, UpdateProfileRequest request);
    Task<JobProfileListItemDto?> RenameAsync(Guid id, Guid userId, string name);
    Task<bool> DeleteAsync(Guid id, Guid userId);
    Task<UpdateProfileRequest?> ExtractAsync(Guid id, Guid userId, IFormFile file);
    Task<ChatResponse?> ChatAsync(Guid id, Guid userId, ChatRequest request);
}
