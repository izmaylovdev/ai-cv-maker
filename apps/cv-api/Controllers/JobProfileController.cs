using System.Security.Claims;
using System.Text;
using CvApi.Data;
using CvApi.DTOs;
using CvApi.Models;
using CvApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig;

namespace CvApi.Controllers;

[ApiController]
[Route("api/job-profiles")]
[Authorize]
public class JobProfileController(AppDbContext db, LlmService llmService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<JobProfileListItemDto>>> List()
    {
        var profiles = await db.Profiles
            .Where(p => p.UserId == UserId)
            .OrderBy(p => p.Name)
            .Select(p => new JobProfileListItemDto(p.Id, p.Name, p.FullName, p.Title))
            .ToListAsync();
        return Ok(profiles);
    }

    [HttpPost]
    public async Task<ActionResult<JobProfileListItemDto>> Create(CreateJobProfileRequest request)
    {
        var profile = new Profile
        {
            UserId = UserId,
            Name = string.IsNullOrWhiteSpace(request.Name) ? "My Profile" : request.Name.Trim(),
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();
        return Ok(new JobProfileListItemDto(profile.Id, profile.Name, profile.FullName, profile.Title));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProfileDto>> Get(Guid id)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == UserId);

        if (profile is null) return NotFound();
        return Ok(MapToDto(profile));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ProfileDto>> Update(Guid id, UpdateProfileRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == UserId);

        if (profile is null) return NotFound();

        profile.Name = string.IsNullOrWhiteSpace(request.Name) ? profile.Name : request.Name.Trim();
        profile.FullName = request.FullName;
        profile.Title = request.Title;
        profile.Overview = request.Overview;
        profile.Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim();
        profile.ContactEmail = request.Contacts?.Email;
        profile.ContactPhone = request.Contacts?.Phone;
        if (request.SectionOrder is { Count: > 0 })
            profile.SectionOrder = string.Join(",", request.SectionOrder);

        db.WorkExperiences.RemoveRange(profile.WorkExperiences);
        db.Educations.RemoveRange(profile.Educations);
        db.Skills.RemoveRange(profile.Skills);

        var workExperiences = request.WorkExperiences.Select(w => new WorkExperience
        {
            ProfileId = profile.Id,
            Company = w.Company,
            Role = w.Role,
            StartDate = w.StartDate,
            EndDate = w.EndDate,
            Description = w.Description
        }).ToList();

        var educations = request.Educations.Select(e => new Education
        {
            ProfileId = profile.Id,
            Institution = e.Institution,
            Degree = e.Degree,
            Field = e.Field,
            StartYear = e.StartYear,
            EndYear = e.EndYear
        }).ToList();

        var skills = request.Skills.Select((s, i) => new Skill
        {
            ProfileId = profile.Id,
            Name = s.Name,
            Order = i,
        }).ToList();

        db.WorkExperiences.AddRange(workExperiences);
        db.Educations.AddRange(educations);
        db.Skills.AddRange(skills);

        await db.SaveChangesAsync();

        profile.WorkExperiences = workExperiences;
        profile.Educations = educations;
        profile.Skills = skills;

        return Ok(MapToDto(profile));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == id && p.UserId == UserId);
        if (profile is null) return NotFound();
        db.Profiles.Remove(profile);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:guid}/optimize")]
    public async Task<ActionResult<OptimizeProfileResponse>> Optimize(Guid id, OptimizeProfileRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest("Message is required.");

        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == UserId);

        if (profile is null) return NotFound();

        var llmRequest = new LlmOptimizeRequest(
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
            request.Message
        );

        LlmOptimizeResponse llmResponse;
        try
        {
            llmResponse = await llmService.OptimizeAsync(llmRequest);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "Profile optimization is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"Profile optimization failed: {ex.Message}");
        }

        return Ok(new OptimizeProfileResponse(
            llmResponse.Title,
            llmResponse.Overview,
            llmResponse.WorkExperiences
                .Select(w => new OptimizeWorkExperienceDto(w.Company, w.Role, w.StartDate, w.EndDate, w.Description))
                .ToList(),
            llmResponse.Skills
                .Select(s => new OptimizeSkillDto(s.Name))
                .ToList()
        ));
    }

    [HttpPost("{id:guid}/enhance-field")]
    public async Task<ActionResult<EnhanceFieldResponse>> EnhanceField(Guid id, EnhanceFieldRequest request)
    {
        var exists = await db.Profiles.AnyAsync(p => p.Id == id && p.UserId == UserId);
        if (!exists) return NotFound();

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest("Content is required.");

        if (string.IsNullOrWhiteSpace(request.FieldPurpose))
            return BadRequest("FieldPurpose is required.");

        LlmEnhanceFieldResponse llmResponse;
        try
        {
            llmResponse = await llmService.EnhanceFieldAsync(new LlmEnhanceFieldRequest(request.Content, request.FieldPurpose));
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "AI enhancement is temporarily unavailable. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"AI enhancement failed: {ex.Message}");
        }

        return Ok(new EnhanceFieldResponse(llmResponse.Enhanced));
    }

    [HttpPost("{id:guid}/extract")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<UpdateProfileRequest>> Extract(Guid id, IFormFile file)
    {
        var exists = await db.Profiles.AnyAsync(p => p.Id == id && p.UserId == UserId);
        if (!exists) return NotFound();

        if (file is null || file.Length == 0)
            return BadRequest("No file uploaded.");

        string cvText;
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();

        if (ext == ".pdf")
        {
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            ms.Position = 0;
            var sb = new StringBuilder();
            using var pdf = PdfDocument.Open(ms);
            foreach (var page in pdf.GetPages())
                sb.AppendLine(page.Text);
            cvText = sb.ToString();
        }
        else
        {
            using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8);
            cvText = await reader.ReadToEndAsync();
        }

        if (string.IsNullOrWhiteSpace(cvText))
            return BadRequest("Could not extract text from the uploaded file.");

        LlmExtractResponse llmResponse;
        try
        {
            llmResponse = await llmService.ExtractAsync(new LlmExtractRequest(cvText));
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "CV extraction is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"CV extraction failed: {ex.Message}");
        }

        var profile = await db.Profiles.FirstAsync(p => p.Id == id);

        return Ok(new UpdateProfileRequest(
            profile.Name,
            llmResponse.FullName,
            llmResponse.Title,
            llmResponse.Overview,
            string.IsNullOrWhiteSpace(llmResponse.Location) ? null : llmResponse.Location,
            new ContactsDto(llmResponse.ContactEmail, llmResponse.ContactPhone),
            llmResponse.WorkExperiences.Select(w => new WorkExperienceDto(
                null, w.Company, w.Role,
                DateOnly.TryParse(w.StartDate, out var sd) ? sd : DateOnly.FromDateTime(DateTime.Today),
                string.IsNullOrEmpty(w.EndDate) ? null : DateOnly.TryParse(w.EndDate, out var ed) ? ed : null,
                w.Description
            )).ToList(),
            llmResponse.Educations.Select(e => new EducationDto(
                null, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear
            )).ToList(),
            llmResponse.Skills.Select(s => new SkillDto(null, s.Name)).ToList(),
            profile.SectionOrder.Split(',').ToList()
        ));
    }

    private static ProfileDto MapToDto(Profile profile) => new(
        profile.Id,
        profile.Name,
        profile.FullName,
        profile.Title,
        profile.Overview,
        profile.Location,
        new ContactsDto(profile.ContactEmail, profile.ContactPhone),
        profile.WorkExperiences.OrderByDescending(w => w.StartDate).Select(w => new WorkExperienceDto(
            w.Id, w.Company, w.Role, w.StartDate, w.EndDate, w.Description)).ToList(),
        profile.Educations.Select(e => new EducationDto(
            e.Id, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear)).ToList(),
        profile.Skills.OrderBy(s => s.Order).Select(s => new SkillDto(s.Id, s.Name)).ToList(),
        profile.SectionOrder.Split(',').ToList()
    );
}
