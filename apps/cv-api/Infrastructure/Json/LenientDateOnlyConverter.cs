using System.Text.Json;
using System.Text.Json.Serialization;

namespace CvApi.Infrastructure.Json;

public class LenientDateOnlyConverter : JsonConverter<DateOnly>
{
    public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var str = reader.GetString();
        if (string.IsNullOrWhiteSpace(str))
            return DateOnly.MinValue;

        if (DateOnly.TryParseExact(str, "yyyy-MM-dd", out var full))
            return full;

        if (DateOnly.TryParseExact(str, "yyyy-MM", out var monthOnly))
            return monthOnly;

        if (DateOnly.TryParse(str, out var fallback))
            return fallback;

        return DateOnly.MinValue;
    }

    public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString("yyyy-MM-dd"));
}

public class LenientNullableDateOnlyConverter : JsonConverter<DateOnly?>
{
    public override DateOnly? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var str = reader.GetString();
        if (string.IsNullOrWhiteSpace(str))
            return null;

        if (DateOnly.TryParseExact(str, "yyyy-MM-dd", out var full))
            return full;

        if (DateOnly.TryParseExact(str, "yyyy-MM", out var monthOnly))
            return monthOnly;

        if (DateOnly.TryParse(str, out var fallback))
            return fallback;

        return null;
    }

    public override void Write(Utf8JsonWriter writer, DateOnly? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value.Value.ToString("yyyy-MM-dd"));
    }
}
