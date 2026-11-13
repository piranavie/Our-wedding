using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using WeddingInvitation.Models;

namespace WeddingInvitation.Services;

public interface IInvitationService
{
	Task<ApiResponse> LookupAsync(string invitationId, CancellationToken cancellationToken = default);
	Task<ApiResponse> SaveAsync(RsvpRequest request, CancellationToken cancellationToken = default);
}

public sealed class InvitationService(HttpClient http, IConfigurationService configuration) : IInvitationService
{
	private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

	public Task<ApiResponse> LookupAsync(string invitationId, CancellationToken cancellationToken = default) =>
		SendAsync(new { action = "lookup", invitationId }, cancellationToken);

	public Task<ApiResponse> SaveAsync(RsvpRequest request, CancellationToken cancellationToken = default) =>
		SendAsync(request, cancellationToken);

	private async Task<ApiResponse> SendAsync<T>(T payload, CancellationToken cancellationToken)
	{
		var config = await configuration.LoadAsync();
		if (string.IsNullOrWhiteSpace(config.ApiEndpoint))
			throw new InvitationException("RSVP is not open online yet. Please contact the couple.", "NOT_CONFIGURED");
		using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
		timeout.CancelAfter(TimeSpan.FromSeconds(25));
		try
		{
			using var content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "text/plain");
			using var response = await http.PostAsync(config.ApiEndpoint, content, timeout.Token);
			response.EnsureSuccessStatusCode();
			var result = await response.Content.ReadFromJsonAsync<ApiResponse>(JsonOptions, timeout.Token);
			if (result is null) throw new InvitationException("The RSVP service returned an empty response.");
			if (!result.Ok) throw new InvitationException(result.Error, result.Code);
			return result;
		}
		catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
		{
			throw new InvitationException("The request timed out. Your response may have saved; retry without changing it.");
		}
		catch (HttpRequestException)
		{
			throw new InvitationException("Unable to reach RSVP. Check your connection and retry. If this continues, contact the couple.");
		}
		catch (JsonException)
		{
			throw new InvitationException("The RSVP service did not return JSON. Please contact the couple to check its public deployment.");
		}
	}
}
