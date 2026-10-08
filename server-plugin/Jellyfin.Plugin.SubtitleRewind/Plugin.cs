using System;
using System.Collections.Generic;
using Jellyfin.Plugin.SubtitleRewind.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.SubtitleRewind
{
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        public static Plugin? Instance { get; private set; }

        public override string Name => "Subtitle Rewind";
        public override Guid Id => Guid.Parse("a5c7f763-71f0-4598-bbcf-f179b068e8d2");
        public override string Description => "Automatically enables subtitles for 60 seconds when skipping backward to catch missed dialogue.";

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
        }

        public IEnumerable<PluginPageInfo> GetPages()
        {
            return new[]
            {
                new PluginPageInfo
                {
                    Name = this.Name,
                    EmbeddedResourcePath = $"{GetType().Namespace}.Web.configPage.html"
                }
            };
        }
    }
}
