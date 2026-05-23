namespace CvApi.Infrastructure.ExternalServices.Llm;

public interface ILlmService
{
    Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request);
    Task<LlmOptimizeResponse> OptimizeAsync(LlmOptimizeRequest request);
    Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request);
    Task<LlmEnhanceFieldResponse> EnhanceFieldAsync(LlmEnhanceFieldRequest request);
}
