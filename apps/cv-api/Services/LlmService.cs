using System.Net.Http.Json;
using System.Text.Json;
using CvApi.DTOs;

namespace CvApi.Services;

public class LlmService(HttpClient httpClient)
{
    private static readonly JsonSerializerOptions _camelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request)
    {
        var response = await httpClient.PostAsJsonAsync("/generate", request, _camelCase);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync();
            throw new HttpRequestException(
                $"LLM service returned {(int)response.StatusCode} {response.ReasonPhrase}: {errorBody}",
                null,
                response.StatusCode);
        }

        return await response.Content.ReadFromJsonAsync<LlmGenerateResponse>()
            ?? throw new InvalidOperationException("Empty response from LLM service");
    }

    public async Task<LlmOptimizeResponse> OptimizeAsync(LlmOptimizeRequest request)
    {
        var response = await httpClient.PostAsJsonAsync("/optimize", request, _camelCase);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync();
            throw new HttpRequestException(
                $"LLM service returned {(int)response.StatusCode} {response.ReasonPhrase}: {errorBody}",
                null,
                response.StatusCode);
        }

        return await response.Content.ReadFromJsonAsync<LlmOptimizeResponse>()
            ?? throw new InvalidOperationException("Empty response from LLM service");
    }
}
