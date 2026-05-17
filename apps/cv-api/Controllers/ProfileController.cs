using System.Security.Claims;
using CvApi.Data;
using CvApi.DTOs;
using CvApi.Models;
using CvApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Controllers;

[ApiController]
[Route("api/profile")]
[Authorize]
public class ProfileController(AppDbContext db, LlmService llmService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<ProfileDto>> Get()
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.UserId == UserId);

        if (profile is null)
            return Ok(new ProfileDto(Guid.Empty, "", "", "", null, null, [], [], []));

        return Ok(MapToDto(profile));
    }

    [HttpPut]
    public async Task<ActionResult<ProfileDto>> Update(UpdateProfileRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.UserId == UserId);

        if (profile is null)
        {
            profile = new Profile { UserId = UserId };
            db.Profiles.Add(profile);
        }

        profile.FullName = request.FullName;
        profile.Title = request.Title;
        profile.Overview = request.Overview;
        profile.Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim();
        profile.ContactEmail = request.Contacts?.Email;
        profile.ContactPhone = request.Contacts?.Phone;

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

    [HttpPost("optimize")]
    public async Task<ActionResult<OptimizeProfileResponse>> Optimize(OptimizeProfileRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest("Message is required.");

        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.UserId == UserId);

        if (profile is null)
            return BadRequest("Profile not found. Please complete your profile first.");

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

    private static ProfileDto MapToDto(Profile profile) => new(
        profile.Id,
        profile.FullName,
        profile.Title,
        profile.Overview,
        profile.Location,
        new ContactsDto(profile.ContactEmail, profile.ContactPhone),
        profile.WorkExperiences.OrderByDescending(w => w.StartDate).Select(w => new WorkExperienceDto(
            w.Id, w.Company, w.Role, w.StartDate, w.EndDate, w.Description)).ToList(),
        profile.Educations.Select(e => new EducationDto(
            e.Id, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear)).ToList(),
        profile.Skills.OrderBy(s => s.Order).Select(s => new SkillDto(s.Id, s.Name)).ToList()
    );
}
