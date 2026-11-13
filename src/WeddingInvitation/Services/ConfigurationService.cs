using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using WeddingInvitation.Models;

namespace WeddingInvitation.Services;

public interface IConfigurationService
{
	Task<AppConfiguration> LoadAsync();
}

public sealed class ConfigurationService(HttpClient http) : IConfigurationService
{
	private AppConfiguration? configuration;

	public async Task<AppConfiguration> LoadAsync()
	{
		if (configuration is not null) return configuration;
		var document = await http.GetFromJsonAsync<JsonElement>($"config.json?v={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}");
		ValidateDates(document);
		var value = document.Deserialize<AppConfiguration>(new JsonSerializerOptions(JsonSerializerDefaults.Web))
			?? throw new InvalidOperationException("Invitation configuration is unavailable.");
		if (string.IsNullOrWhiteSpace(value.CoupleNames) || value.Wedding.Start == default ||
			value.Wedding.End <= value.Wedding.Start || value.Rsvp.ClosesAt == default ||
			value.Rsvp.ClosesAt >= value.Wedding.Start || value.Rsvp.MaxAttending is < 1 or > 30 ||
			value.Rsvp.MaxMembers is < 1 or > 30 || value.MusicVolume is < 0 or > 1)
			throw new InvalidOperationException("Please check the wedding dates and RSVP settings in config.json.");
		foreach (var url in new[] { value.InvitationImage, value.SaveTheDateImage, value.MusicUrl })
			ValidateUrl(url, allowRelative: true);
		foreach (var url in new[] { value.ApiEndpoint, value.Wedding.MapUrl, value.Rsvp.ContactUrl,
			value.Calendar.GoogleUrl, value.Calendar.OutlookUrl })
			ValidateUrl(url, allowRelative: false);
		configuration = value;
		return value;
	}

	private static void ValidateDates(JsonElement document)
	{
		var wedding = RequiredObject(document, "wedding");
		RequireTimestamp(wedding, "start");
		RequireTimestamp(wedding, "end");
		RequireTimestamp(RequiredObject(document, "rsvp"), "closesAt");
		if (!document.TryGetProperty("programme", out var programme)) return;
		if (programme.ValueKind != JsonValueKind.Array)
			throw new InvalidOperationException("The wedding programme must be an array.");
		foreach (var item in programme.EnumerateArray()) RequireTimestamp(item, "start");
	}

	private static JsonElement RequiredObject(JsonElement parent, string property)
	{
		if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(property, out var value) ||
			value.ValueKind != JsonValueKind.Object)
			throw new InvalidOperationException($"Configuration must include a {property} object.");
		return value;
	}

	private static void RequireTimestamp(JsonElement parent, string property)
	{
		if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(property, out var value) ||
			value.ValueKind != JsonValueKind.String ||
			!Regex.IsMatch(value.GetString()!, @"(Z|[+-][0-9]{2}:[0-9]{2})\z") ||
			!value.TryGetDateTimeOffset(out _))
			throw new InvalidOperationException($"Configuration {property} must be a valid ISO timestamp with an explicit timezone offset.");
	}

	private static void ValidateUrl(string value, bool allowRelative)
	{
		if (string.IsNullOrWhiteSpace(value)) return;
		if (Uri.TryCreate(value, UriKind.Absolute, out var absolute) && absolute.Scheme == "https") return;
		if (allowRelative && !value.StartsWith('/') && !value.Contains(':') && !value.Contains('\\') &&
			Uri.TryCreate(value, UriKind.Relative, out _)) return;
		throw new InvalidOperationException("Configuration links must use HTTPS; local assets may use relative paths.");
	}
}
