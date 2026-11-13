using System.ComponentModel.DataAnnotations;

namespace WeddingInvitation.Models;

public sealed class Household
{
	public string InvitationId { get; set; } = "";
	public string FamilyName { get; set; } = "";
	public int ExpectedFamilyCount { get; set; }
	public string Status { get; set; } = "Pending";
	public int AttendingCount { get; set; }
	public string LastUpdated { get; set; } = "";
}

public sealed class RsvpFormModel
{
	[Required, StringLength(120)]
	public string FamilyName { get; set; } = "";
	[Required, RegularExpression("^(Accepted|Declined)$", ErrorMessage = "Please accept or decline the invitation.")]
	public string Status { get; set; } = "";
	[Range(0, 30)]
	public int AttendingCount { get; set; }
}

public sealed record RsvpRequest(string Action, string InvitationId, string FamilyName,
	string Status, int AttendingCount,
	string RequestId, string ExpectedVersion);

public sealed class ApiResponse
{
	public bool Ok { get; set; }
	public string Error { get; set; } = "";
	public string Code { get; set; } = "";
	public Household? Household { get; set; }
	public DateTimeOffset? ClosesAt { get; set; }
	public bool Closed { get; set; }
}

public sealed class InvitationException(string message, string code = "") : Exception(message)
{
	public string Code { get; } = code;
}
