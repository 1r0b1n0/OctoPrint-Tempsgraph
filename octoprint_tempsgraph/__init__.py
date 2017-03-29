# coding=utf-8
from __future__ import absolute_import

import octoprint.plugin

class TempsgraphPlugin(octoprint.plugin.SettingsPlugin,
                       octoprint.plugin.AssetPlugin):

    ##~~ SettingsPlugin mixin

    def get_settings_defaults(self):
        return dict(
            # put your plugin's default settings here
        )

    ##~~ AssetPlugin mixin

    def get_assets(self):
        # Define your plugin's asset files to automatically include in the
        # core UI here.
        return dict(
                        js=["js/tempsgraph.js", "js/plotly-latest.min.js"],
                        css=["css/tempsgraph.css"]
#			less=["less/tempsgraph.less"]
        )

    ##~~ Softwareupdate hook

    def get_update_information(self):
        # Define the configuration for your plugin to use with the Software Update
        # Plugin here. See https://github.com/foosel/OctoPrint/wiki/Plugin:-Software-Update
        # for details.
        return dict(
            tempsgraph=dict(
                displayName="Tempsgraph Plugin",
                displayVersion=self._plugin_version,

                # version check: github repository
                type="github_release",
                user="1r0b1n0",
                repo="OctoPrint-Tempsgraph",
                current=self._plugin_version,

                # update method: pip
                pip="https://github.com/1r0b1n0/OctoPrint-Tempsgraph/archive/{target_version}.zip"
            )
        )


__plugin_name__ = "Tempsgraph Plugin"

def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = TempsgraphPlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
    }
