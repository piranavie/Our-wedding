using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using WeddingInvitation;
using WeddingInvitation.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");
builder.Services.AddScoped(_ => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<IConfigurationService, ConfigurationService>();
builder.Services.AddScoped<IInvitationService, InvitationService>();
builder.Services.AddScoped<BrowserService>();
builder.Services.AddScoped<CalendarService>();
await builder.Build().RunAsync();
