namespace WeddingInvitation.Models;

public sealed class AppConfiguration
{
	public string CoupleNames { get; set; } = "";
	public string WelcomeText { get; set; } = "";
	public string BlessingText { get; set; } = "";
	public string ApiEndpoint { get; set; } = "";
	public string InvitationImage { get; set; } = "";
	public string SaveTheDateImage { get; set; } = "";
	public string MusicUrl { get; set; } = "";
	public double MusicVolume { get; set; } = 0.35;
	public WeddingDetails Wedding { get; set; } = new();
	public RsvpSettings Rsvp { get; set; } = new();
	public CalendarSettings Calendar { get; set; } = new();
	public List<ProgrammeEvent> Programme { get; set; } = [];
}

public sealed class WeddingDetails
{
	public string Title { get; set; } = "";
	public string VenueName { get; set; } = "";
	public string Address { get; set; } = "";
	public string MapUrl { get; set; } = "";
	public string TimeZone { get; set; } = "Europe/London";
	public DateTimeOffset Start { get; set; }
	public DateTimeOffset End { get; set; }
}

public sealed class RsvpSettings
{
	public DateTimeOffset ClosesAt { get; set; }
	public string DeadlineLabel { get; set; } = "";
	public int MaxAttending { get; set; } = 30;
	public int MaxMembers { get; set; } = 30;
	public string ContactUrl { get; set; } = "";
}

public sealed class CalendarSettings
{
	public string GoogleUrl { get; set; } = "";
	public string OutlookUrl { get; set; } = "";
	public string FileName { get; set; } = "wedding.ics";
	public string EventId { get; set; } = "";
}

public sealed class ProgrammeEvent
{
	public string Title { get; set; } = "";
	public string Description { get; set; } = "";
	public DateTimeOffset Start { get; set; }
}
