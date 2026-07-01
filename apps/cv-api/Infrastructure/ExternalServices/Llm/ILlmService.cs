namespace CvApi.Infrastructure.ExternalServices.Llm;

public interface ILlmService
{
    Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request);
    Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request);
    Task<LlmChatResponse> ChatAsync(LlmChatRequest request);
    Task<LlmUserChatResponse> UserChatAsync(LlmUserChatRequest request);
    Task<LlmJobChatResponse> JobChatAsync(LlmJobChatRequest request);
    Task<LlmCoverLetterResponse> GenerateCoverLetterAsync(LlmCoverLetterRequest request);
    Task<LlmSelectBestProfileResponse> SelectBestProfileAsync(LlmSelectBestProfileRequest request);
}
