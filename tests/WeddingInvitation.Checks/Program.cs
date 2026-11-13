using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using WeddingInvitation.Models;
using WeddingInvitation.Services;

var configJson = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "config.json"));
var config = JsonSerializer.Deserialize<AppConfiguration>(configJson, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
var calendar = new CalendarService();
var checks = 0;
void Check(bool condition, string name)
{
	if (!condition) throw new InvalidOperationException("Failed: " + name);
	Console.WriteLine("PASS: " + name);
	checks++;
}
Check(config.Wedding.Start.UtcDateTime == new DateTime(2027, 8, 28, 9, 0, 0, DateTimeKind.Utc), "UK wedding instant");
Check(config.Rsvp.ClosesAt.UtcDateTime == new DateTime(2027, 8, 8, 23, 0, 0, DateTimeKind.Utc), "End-of-August-8 UK cutoff");
Check(config.ApiEndpoint == "" || config.ApiEndpoint.StartsWith("https://"), "API config is blank or HTTPS");
var google = Uri.UnescapeDataString(calendar.GoogleUrl(config));
Check(google.Contains("20270828T090000Z/20270828T170000Z"), "Google Calendar uses UTC dates");
var outlook = Uri.UnescapeDataString(calendar.OutlookUrl(config));
Check(outlook.Contains("2027-08-28T09:00:00"), "Outlook uses UTC start");
var ics = calendar.CreateIcs(config);
Check(ics.Contains("DTSTART:20270828T090000Z\r\n"), "ICS start");
Check(ics.Contains("DTEND:20270828T170000Z\r\n"), "ICS end");
Check(ics.EndsWith("END:VCALENDAR\r\n"), "ICS CRLF terminator");
config.BlessingText = "Tamil தமிழ்; love, joy\\family\n" + new string('இ', 100);
ics = calendar.CreateIcs(config);
Check(ics.Split("\r\n").All(line => Encoding.UTF8.GetByteCount(line) <= 75), "ICS Unicode folding at 75 octets");
Check(ics.Replace("\r\n ", "").Contains("தமிழ்\\; love\\, joy\\\\family\\n"), "ICS text escaping");
Check(ics.Contains("UID:" + config.Calendar.EventId), "ICS stable event ID");
config.CoupleNames = "Arun & Meena";
config.Wedding.Title = "Thaali; Wedding";
config.Wedding.VenueName = "Hall, East";
config.Wedding.Address = "1 Wedding Road";
var expectedTitle = "Arun & Meena · Thaali; Wedding";
var expectedLocation = "Hall, East, 1 Wedding Road";
google = calendar.GoogleUrl(config);
outlook = calendar.OutlookUrl(config);
Check(google.Contains("text=" + Uri.EscapeDataString(expectedTitle)), "Google title encoding");
Check(outlook.Contains("subject=" + Uri.EscapeDataString(expectedTitle)), "Outlook title encoding");
Check(google.Contains("location=" + Uri.EscapeDataString(expectedLocation)) &&
	outlook.Contains("location=" + Uri.EscapeDataString(expectedLocation)), "Calendar providers share location formatting");
ics = calendar.CreateIcs(config).Replace("\r\n ", "");
Check(ics.Contains("SUMMARY:Arun & Meena · Thaali\\; Wedding\r\n"), "ICS shared title remains escaped");
Check(ics.Contains("LOCATION:Hall\\, East\\, 1 Wedding Road\r\n"), "ICS shared location remains escaped");
var form = new RsvpFormModel { FamilyName = "Family", Status = "Accepted", AttendingCount = 2 };
Check(Validator.TryValidateObject(form, new ValidationContext(form), [], true), "Valid form annotations");
form.Status = "Pending";
Check(!Validator.TryValidateObject(form, new ValidationContext(form), [], true), "Pending is not a submission");
var minimalRequest = new RsvpRequest("rsvp", new string('a', 32), "Family", "Accepted", 2, new string('b', 32), "version");
using (var payload = JsonDocument.Parse(JsonSerializer.Serialize(minimalRequest, new JsonSerializerOptions(JsonSerializerDefaults.Web))))
{
	Check(!payload.RootElement.TryGetProperty("primaryContactName", out _) && !payload.RootElement.TryGetProperty("members", out _), "Minimal request does not collect individual names");
	Check(payload.RootElement.GetProperty("familyName").GetString() == "Family" && payload.RootElement.GetProperty("attendingCount").GetInt32() == 2, "Minimal request includes family and count");
}

using (var handler = new ConfigurationHandler(configJson))
using (var client = new HttpClient(handler) { BaseAddress = new Uri("https://example.com/wedding/") })
{
	var loader = new ConfigurationService(client);
	var loaded = await loader.LoadAsync();
	Check(loaded.CoupleNames == JsonNode.Parse(configJson)!["coupleNames"]!.GetValue<string>(), "Configuration loader reads JSON");
	Check(ReferenceEquals(loaded, await loader.LoadAsync()) && handler.Requests == 1, "Validated configuration is cached");
	Check(handler.LastUri!.AbsolutePath == "/wedding/config.json", "Configuration resolves under deployment base path");
}

var configurationCases = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "configuration-cases.json")))!.AsArray();
foreach (var scenario in configurationCases)
{
	var candidate = JsonNode.Parse(configJson)!;
	var segments = scenario!["path"]!.GetValue<string>().Split('.');
	var target = candidate;
	foreach (var segment in segments[..^1])
		target = target is JsonArray array ? array[int.Parse(segment)]! : target[segment]!;
	if (target is JsonArray targetArray) targetArray[int.Parse(segments[^1])] = scenario["value"]?.DeepClone();
	else target[segments[^1]] = scenario["value"]?.DeepClone();
	using var handler = new ConfigurationHandler(candidate.ToJsonString());
	using var client = new HttpClient(handler) { BaseAddress = new Uri("https://example.com/wedding/") };
	var accepted = true;
	try { await new ConfigurationService(client).LoadAsync(); }
	catch (InvalidOperationException) { accepted = false; }
	Check(accepted == scenario["valid"]!.GetValue<bool>(), "Shared configuration: " + scenario["name"]!.GetValue<string>());
}
Console.WriteLine($"{checks} C# checks passed.");

sealed class ConfigurationHandler(string json) : HttpMessageHandler
{
	public int Requests { get; private set; }
	public Uri? LastUri { get; private set; }
	protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
	{
		Requests++;
		LastUri = request.RequestUri;
		return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
		{
			Content = new StringContent(json, Encoding.UTF8, "application/json")
		});
	}
}
