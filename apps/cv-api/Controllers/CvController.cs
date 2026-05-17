using System.Security.Claims;
using System.Text.Json;
using CvApi.Data;
using CvApi.DTOs;
using CvApi.Models;
using CvApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Controllers;

[ApiController]
[Route("api/cv")]
[Authorize]
public class CvController(AppDbContext db, LlmService llmService, PdfService pdfService) : ControllerBase
{
    private static readonly JsonSerializerOptions _jsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions _jsonCamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<CvListItemDto>>> GetAll()
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.UserId == UserId);
        if (profile is null) return Ok(new List<CvListItemDto>());

        var cvs = await db.GeneratedCvs
            .Where(g => g.ProfileId == profile.Id)
            .OrderByDescending(g => g.CreatedAt)
            .Select(g => new CvListItemDto(g.Id, g.CreatedAt, g.OptimizationNotes, g.Title))
            .ToListAsync();

        return Ok(cvs);
    }

    [HttpPost]
    public async Task<ActionResult<CvListItemDto>> Create(CreateCvRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.UserId == UserId);

        if (profile is null)
            return BadRequest("Profile not found. Please complete your profile first.");

        var llmRequest = new LlmGenerateRequest(
            new LlmProfileRequest(
                profile.FullName,
                profile.Title,
                profile.Overview,
                profile.Location,
                profile.WorkExperiences
                    .OrderByDescending(w => w.EndDate ?? DateOnly.MaxValue)
                    .ThenByDescending(w => w.StartDate)
                    .Select(w => new WorkExperienceDto(w.Id, w.Company, w.Role, w.StartDate, w.EndDate, w.Description))
                    .ToList(),
                profile.Educations
                    .OrderByDescending(e => e.EndYear ?? int.MaxValue)
                    .ThenByDescending(e => e.StartYear)
                    .Select(e => new EducationDto(e.Id, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear))
                    .ToList(),
                profile.Skills.OrderBy(s => s.Order).Select(s => new SkillDto(s.Id, s.Name)).ToList()
            ),
            string.IsNullOrWhiteSpace(request.OptimizationNotes) ? null : request.OptimizationNotes
        );

        LlmGenerateResponse llmResponse;
        try
        {
            llmResponse = await llmService.GenerateAsync(llmRequest);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "CV generation is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"CV generation failed: {ex.Message}");
        }

        var generatedCv = new GeneratedCv
        {
            ProfileId = profile.Id,
            OptimizationNotes = string.IsNullOrWhiteSpace(request.OptimizationNotes) ? null : request.OptimizationNotes.Trim(),
            FullName = profile.FullName,
            Title = profile.Title,
            Location = profile.Location,
            ContactEmail = profile.ContactEmail,
            ContactPhone = profile.ContactPhone,
            CvDataJson = JsonSerializer.Serialize(llmResponse, _jsonCamelCase)
        };

        db.GeneratedCvs.Add(generatedCv);
        await db.SaveChangesAsync();

        return Ok(new CvListItemDto(generatedCv.Id, generatedCv.CreatedAt, generatedCv.OptimizationNotes, generatedCv.Title));
    }

    [HttpGet("{id:guid}/pdf")]
    public async Task<IActionResult> GetPdf(Guid id)
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.UserId == UserId);
        if (profile is null) return NotFound();

        var cv = await db.GeneratedCvs.FirstOrDefaultAsync(g => g.Id == id && g.ProfileId == profile.Id);
        if (cv is null) return NotFound();

        var cvData = JsonSerializer.Deserialize<LlmGenerateResponse>(cv.CvDataJson, _jsonOptions);
        if (cvData is null) return StatusCode(500, "CV data is corrupted.");

        var pdf = pdfService.GenerateCv(cvData, cv.FullName, cv.Title, cv.Location, cv.ContactEmail, cv.ContactPhone);
        return File(pdf, "application/pdf", $"{cv.FullName.Replace(" ", "_")}_CV.pdf");
    }

    [HttpGet("default/pdf")]
    public async Task<IActionResult> GetDefaultPdf()
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.UserId == UserId);

        if (profile is null) return NotFound();

        var cvData = new LlmGenerateResponse(
            Summary: profile.Overview,
            WorkExperiences: profile.WorkExperiences
                .OrderByDescending(w => w.EndDate ?? DateOnly.MaxValue)
                .ThenByDescending(w => w.StartDate)
                .Select(w => new LlmWorkExperience(
                    w.Company,
                    w.Role,
                    FormatPeriod(w.StartDate, w.EndDate),
                    w.Description ?? ""))
                .ToList(),
            Educations: profile.Educations
                .OrderByDescending(e => e.EndYear ?? int.MaxValue)
                .ThenByDescending(e => e.StartYear)
                .Select(e => new LlmEducation(
                    e.Institution,
                    e.Degree,
                    e.Field,
                    e.EndYear.HasValue ? $"{e.StartYear} – {e.EndYear}" : $"{e.StartYear} – Present"))
                .ToList(),
            Skills: profile.Skills.OrderBy(s => s.Order).Select(s => s.Name).ToList(),
            Highlights: []
        );

        var pdf = pdfService.GenerateCv(cvData, profile.FullName, profile.Title, profile.Location, profile.ContactEmail, profile.ContactPhone);
        return File(pdf, "application/pdf", $"{profile.FullName.Replace(" ", "_")}_CV.pdf");
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.UserId == UserId);
        if (profile is null) return NotFound();

        var cv = await db.GeneratedCvs.FirstOrDefaultAsync(g => g.Id == id && g.ProfileId == profile.Id);
        if (cv is null) return NotFound();

        db.GeneratedCvs.Remove(cv);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static string FormatPeriod(DateOnly start, DateOnly? end)
    {
        var s = start.ToString("MMM yyyy");
        var e = end.HasValue ? end.Value.ToString("MMM yyyy") : "Present";
        return $"{s} – {e}";
    }
}
