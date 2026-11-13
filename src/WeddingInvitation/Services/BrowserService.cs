using Microsoft.JSInterop;

namespace WeddingInvitation.Services;

public sealed class BrowserService(IJSRuntime js) : IAsyncDisposable
{
	private Task<IJSObjectReference>? module;
	private Task<IJSObjectReference> Module => module ??= js.InvokeAsync<IJSObjectReference>("import", "./js/invitation.js").AsTask();

	public async Task<string> LocalDateAsync(DateTimeOffset date) =>
		await (await Module).InvokeAsync<string>("formatLocalDate", date.ToString("O"));
	public async Task PrepareMusicAsync(string url, double volume) =>
		await (await Module).InvokeVoidAsync("prepareMusic", url, volume);
	public async Task<string> InvitationIdAsync() => await (await Module).InvokeAsync<string>("getInvitationId");
	public async Task DownloadAsync(string filename, string content) =>
		await (await Module).InvokeVoidAsync("downloadCalendar", filename, content);
	public async Task FocusAsync(string id) => await (await Module).InvokeVoidAsync("focusElement", id);

	public async ValueTask DisposeAsync()
	{
		if (module is not null) await (await module).DisposeAsync();
	}
}
