using System.Globalization;
using System.Text;
using WeddingInvitation.Models;

namespace WeddingInvitation.Services;

public sealed class CalendarService
{
	private static string EventTitle(AppConfiguration config) => $"{config.CoupleNames} · {config.Wedding.Title}";
	private static string EventLocation(AppConfiguration config) => $"{config.Wedding.VenueName}, {config.Wedding.Address}";
	private static string Utc(DateTimeOffset value) => value.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
	private static string Escape(string text) => text.Replace("\\", "\\\\").Replace("\r", "").Replace("\n", "\\n").Replace(";", "\\;").Replace(",", "\\,");
	private static string Query(string endpoint, params (string Key, string Value)[] values) => endpoint +
		(endpoint.Contains('?') ? "&" : "?") + string.Join("&", values.Select(x => $"{x.Key}={Uri.EscapeDataString(x.Value)}"));

	public string GoogleUrl(AppConfiguration config) => Query(config.Calendar.GoogleUrl,
		("action", "TEMPLATE"), ("text", EventTitle(config)),
		("dates", $"{Utc(config.Wedding.Start)}/{Utc(config.Wedding.End)}"),
		("details", config.BlessingText), ("location", EventLocation(config)));

	public string OutlookUrl(AppConfiguration config) => Query(config.Calendar.OutlookUrl,
		("path", "/calendar/action/compose"), ("rru", "addevent"),
		("subject", EventTitle(config)),
		("startdt", config.Wedding.Start.UtcDateTime.ToString("O")), ("enddt", config.Wedding.End.UtcDateTime.ToString("O")),
		("body", config.BlessingText), ("location", EventLocation(config)));

	public string CreateIcs(AppConfiguration config)
	{
		var lines = new[] { "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WeddingInvitation//EN", "CALSCALE:GREGORIAN",
			"METHOD:PUBLISH", "BEGIN:VEVENT", $"UID:{Escape(config.Calendar.EventId)}", $"DTSTAMP:{Utc(DateTimeOffset.UtcNow)}",
			$"DTSTART:{Utc(config.Wedding.Start)}", $"DTEND:{Utc(config.Wedding.End)}",
			$"SUMMARY:{Escape(EventTitle(config))}",
			$"LOCATION:{Escape(EventLocation(config))}",
			$"DESCRIPTION:{Escape(config.BlessingText)}", "END:VEVENT", "END:VCALENDAR" };
		return string.Join("\r\n", lines.Select(FoldLine)) + "\r\n";
	}

	private static string FoldLine(string line)
	{
		var result = new StringBuilder();
		var width = 0;
		foreach (var rune in line.EnumerateRunes())
		{
			if (width + rune.Utf8SequenceLength > 75) { result.Append("\r\n "); width = 1; }
			result.Append(rune.ToString());
			width += rune.Utf8SequenceLength;
		}
		return result.ToString();
	}
}
