namespace CvApi.Infrastructure.ExternalServices.Llm;

public interface ILlmService
{
    Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request);
    Task<LlmOptimizeResponse> OptimizeAsync(LlmOptimizeRequest request);
    Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request);
    Task<LlmEnhanceFieldResponse> EnhanceFieldAsync(LlmEnhanceFieldRequest request);
    Task<LlmChatResponse> ChatAsync(LlmChatRequest request);
    Task<LlmUserChatResponse> UserChatAsync(LlmUserChatRequest request);
    Task<LlmCoverLetterResponse> GenerateCoverLetterAsync(LlmCoverLetterRequest request);
}
