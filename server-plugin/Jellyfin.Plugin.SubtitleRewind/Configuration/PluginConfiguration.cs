using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.SubtitleRewind.Configuration
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        public bool Enabled { get; set; } = true;
        public int RewindCapSeconds { get; set; } = 90;
        public int DisplayDurationSeconds { get; set; } = 60;
        public string PreferredLanguage { get; set; } = string.Empty;
        public bool PrioritizeTextOverBitmap { get; set; } = true;
        public bool AllowSDH { get; set; } = true;
        public bool DebugLogging { get; set; } = false;
    }
}
