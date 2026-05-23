using CvApi.Features.Cvs.Dtos;

namespace CvApi.Features.Cvs;

public interface ICvService
{
    Task<List<CvListItemDto>?> GetAllAsync(Guid profileId, Guid userId);
    Task<CvListItemDto?> CreateAsync(Guid profileId, Guid userId, CreateCvRequest request);
    Task<(byte[] Bytes, string Filename)?> GetPdfAsync(Guid profileId, Guid id, Guid userId);
    Task<(byte[] Bytes, string Filename)?> GetDefaultPdfAsync(Guid profileId, Guid userId);
    Task<bool> DeleteAsync(Guid profileId, Guid id, Guid userId);
}
