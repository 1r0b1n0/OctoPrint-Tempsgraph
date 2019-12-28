/*
 * View model for OctoPrint-tempsgraph
 *
 * Author: Robin
 * License: MIT
 */

$(function() {
    function TempsgraphViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.settingsViewModel = parameters[1];

        self._createToolEntry = function() {
            return {
                name: ko.observable(),
                key: ko.observable(),
                actual: ko.observable(0),
                target: ko.observable(0),
                newTarget: ko.observable(),
            }
        };

        self.tools = ko.observableArray([]);
        self.hasBed = ko.observable(true);
        self.bedTemp = self._createToolEntry();
        self.bedTemp["name"](gettext("Bed"));
        self.bedTemp["key"]("bed");

        self.hasChamber = ko.observable(false);
        self.chamberTemp = self._createToolEntry();
        self.chamberTemp["name"](gettext("Chamber"));
        self.chamberTemp["key"]("chamber");

        self.isErrorOrClosed = ko.observable(undefined);
        self.isOperational = ko.observable(undefined);
        self.isPrinting = ko.observable(undefined);
        self.isPaused = ko.observable(undefined);
        self.isError = ko.observable(undefined);
        self.isReady = ko.observable(undefined);
        self.isLoading = ko.observable(undefined);
       
        self.temperature_profiles = self.settingsViewModel.temperature_profiles;
        self.temperature_cutoff = self.settingsViewModel.temperature_cutoff;
        self.ownSettings = {}
        self.heaterOptions = ko.observable({});
        self.prevHeaterKeys = "";

        self._printerProfileInitialized = false;
        self._currentTemperatureDataBacklog = [];
        self._historyTemperatureDataBacklog = [];

        self.showFahrenheit = false;
        self.temperatures = [];

        self.plot = null; // plotly graph
        
        self.defaultColors = {
            background: '#ffffff',
            axises: '#000000'
        }
        self.defaultImageData = {
                                  x: 0.5,
                                  y: 0.9,
                                  sizex: 0.8,
                                  sizey: 0.8,
                                    // desired custom background file must be placed into source directory
                                  source: "../static/img/graph-background.png", // e.g."../static/img/CUSTOM-background.png"
                                  xanchor: "center",
                                  xref: "paper",
                                  yanchor: "center",
                                  yref: "paper"
                                };
        self.subscriptions = [];

        self._printerProfileUpdated = function() {
            var graphColors = ["red", "orange", "green", "brown", "purple", "fuchsia"];
            var heaterOptions = {};
            var tools = self.tools();
            var color;

            self.showFahrenheit = (self.settingsViewModel.settings !== undefined )
                     ? self.settingsViewModel.settings.appearance.showFahrenheitAlso()
                     : false;

            // tools
            var currentProfileData = self.settingsViewModel.printerProfiles.currentProfileData();
            var numExtruders = (currentProfileData ? currentProfileData.extruder.count() : 0);
            var sharedNozzle = (currentProfileData ? currentProfileData.extruder.sharedNozzle() : false);
            if (numExtruders && numExtruders > 1 && !sharedNozzle) {
                // multiple extruders
                for (var extruder = 0; extruder < numExtruders; extruder++) {
                    color = graphColors.shift();
                    if (!color) color = "black";
                    heaterOptions["tool" + extruder] = {name: "T" + extruder, color: color};

                    if (tools.length <= extruder || !tools[extruder]) {
                        tools[extruder] = self._createToolEntry();
                    }
                    tools[extruder]["name"](gettext("Tool") + " " + extruder);
                    tools[extruder]["key"]("tool" + extruder);
                }
            } else if (numExtruders == 1 || sharedNozzle) {
                // only one extruder, no need to add numbers
                color = graphColors[0];
                heaterOptions["tool0"] = {name: "T", color: color};

                if (tools.length < 1 || !tools[0]) {
                    tools[0] = self._createToolEntry();
                }
                tools[0]["name"](gettext("Tool"));
                tools[0]["key"]("tool0");
            }

            // print bed
            if (currentProfileData && currentProfileData.heatedBed()) {
                self.hasBed(true);
                heaterOptions["bed"] = {name: gettext("Bed"), color: "blue"};
            } else {
                self.hasBed(false);
            }

            if (currentProfileData && currentProfileData.heatedChamber()) {
                self.hasChamber(true);
                heaterOptions["chamber"] = {name: gettext("Chamber"), color: "black"};
            } else {
                self.hasChamber(false);
            }

            // write back
            self.heaterOptions(heaterOptions);
            self.tools(tools);

            // reset if necessary
            if(self.prevHeaterKeys != _.keys(self.heaterOptions()).join()) {
                self.temperatures = [];
            }
            self.prevHeaterKeys = _.keys(self.heaterOptions()).join();


            if (!self._printerProfileInitialized) {
                self._triggerBacklog();
            }
        };
        self.settingsViewModel.printerProfiles.currentProfileData.subscribe(function() {
            //Only update if viewModel is bound
            self._bound && self._printerProfileUpdated();
            self.settingsViewModel.printerProfiles.currentProfileData().extruder.count.subscribe(self._printerProfileUpdated);
            self.settingsViewModel.printerProfiles.currentProfileData().extruder.sharedNozzle.subscribe(self._printerProfileUpdated);
            self.settingsViewModel.printerProfiles.currentProfileData().heatedBed.subscribe(self._printerProfileUpdated);
            self.settingsViewModel.printerProfiles.currentProfileData().heatedChamber.subscribe(self._printerProfileUpdated);
        });

        self.fromCurrentData = function(data) {
            self._processStateData(data.state);
            if (!self._printerProfileInitialized) {
                self._currentTemperatureDataBacklog.push(data);
            } else {
                self._processTemperatureUpdateData(data.serverTime, data.temps);
            }
        };

        self.fromHistoryData = function(data) {
            self._processStateData(data.state);
            if (!self._printerProfileInitialized) {
                self._historyTemperatureDataBacklog.push(data);
            } else {
                self._processTemperatureHistoryData(data.serverTime, data.temps);
            }
        };

        self._triggerBacklog = function() {
            _.each(self._historyTemperatureDataBacklog, function(data) {
                self._processTemperatureHistoryData(data.serverTime, data.temps);
            });
            _.each(self._currentTemperatureDataBacklog, function(data) {
                self._processTemperatureUpdateData(data.serverTime, data.temps);
            });
            self._historyTemperatureDataBacklog = [];
            self._currentTemperatureDataBacklog = [];
            self._printerProfileInitialized = true;
            
            var bodyBgColor = self.defaultColors.background = $('body').css('backgroundColor');
            var axisesColor = self.defaultColors.axises;
            if(self.selectedBackground && self.selectedBackground() != "Default") {
                bodyBgColor = self.backgroundColor();
            }
            if(self.selectedAxises && self.selectedAxises() != "Default") {
                axisesColor = self.axisesColor();
                }
            var tempDiv = document.getElementById("#temperature-graph");
            if($("#temperature-graph").length)
            {
                $("#temperature-graph").parent().remove();
                $("#temp").prepend('<div class="row-fluid"><div id="div_g"></div></div>');

                self.plot = document.getElementById("div_g");
                var data = [];
                var heaterKeys = _.keys(self.heaterOptions())
                var heaterOptions = self.heaterOptions()

                for(var i=0;i<heaterKeys.length;i++) {
                    data.push({
                        x: [],
                        y: [],
                        type: 'scatter',
                        mode: 'lines',
                        line: {
                            width: 6.0,
                            color: pusher.color(heaterOptions[heaterKeys[i]].color).tint(0.7).html()
                        },
                        name: heaterKeys[i]+"_target"
                    });
                    data.push({
                        x: [],
                        y: [],
                        type: 'scatter',
                        mode: 'lines',
                        line: {
                            width: 2.0,
                            color: heaterOptions[heaterKeys[i]].color
                        },
                        name: heaterKeys[i]+"_actual"
                    });
                }

                for(var i=0,len=0;i<self.temperatures.length;i++) {
                    for(var j=1,len=0;j<self.temperatures[i].length;j++) {
                        data[j-1].x.push(self.temperatures[i][0]);
                        data[j-1].y.push(self.temperatures[i][j]);
                    }
                }

                var layout = {
                  xaxis: {
                    showgrid: true,
                    zeroline: false,
                    linecolor: 'gray',
                    linewidth: 1,
                    mirror: true,
                    color: axisesColor
                  },
                  yaxis: {
                    range: [0, self.getMaxTemp()],
                    linecolor: 'gray',
                    linewidth: 1,
                    mirror: true,
                    color: axisesColor
                  },
                  images: [
                        {
                          x: 0.5,
                          y: 0.9,
                          sizex: 0.8,
                          sizey: 0.8,
                            // desired custom background file must be placed into source directory 
                          source: "../static/img/graph-background.png", // e.g."../static/img/CUSTOM-background.png"
                          xanchor: "center",
                          xref: "paper",
                          yanchor: "center",
                          yref: "paper"
                        }
                      ],
                  margin: {
                    l: 30,
                    r: 30,
                    b: 50,
                    t: 30,
                    pad: 4
                  },
                  //width: 588,
                  height: 400,
                  showlegend: false,
                  hovermode: "x",
                  // dark style support
                  paper_bgcolor: bodyBgColor,
                  plot_bgcolor: bodyBgColor,
                };

                if(!self.ownSettings.showBackgroundImage())
                {
                    layout['images'] = [];
                }
                else
                {
                    layout['images'] = [self.defaultImageData];
                }

                if (!self.ownSettings.startWithAutoScale())
                {
                    layout['yaxis']['autorange'] = false;
                    layout['yaxis']['range'] = [0, self.getMaxTemp()];
                }
                else
                {
                    layout['yaxis']['autorange'] = true;
                }

                // bufgix for z-index of modbar
                $("<style>")
                    .prop("type", "text/css")
                    .html("\
                    .js-plotly-plot .plotly .modebar {\
                        z-index: 999;\
                    }")
                    .appendTo("head");

                Plotly.plot(self.plot, data, layout);
            }

        };

        self._processStateData = function(data) {
            self.isErrorOrClosed(data.flags.closedOrError);
            self.isOperational(data.flags.operational);
            self.isPaused(data.flags.paused);
            self.isPrinting(data.flags.printing);
            self.isError(data.flags.error);
            self.isReady(data.flags.ready);
            self.isLoading(data.flags.loading);
        };

        self._processTemperatureUpdateData = function(serverTime, data) {
            if (data.length == 0)
                return;

            var lastData = data[data.length - 1];

            var tools = self.tools();
            for (var i = 0; i < tools.length; i++) {
                if (lastData.hasOwnProperty("tool" + i)) {
                    tools[i]["actual"](lastData["tool" + i].actual);
                    tools[i]["target"](lastData["tool" + i].target);
                } else {
                    tools[i]["actual"](0);
                    tools[i]["target"](0);
                }
            }

            if (lastData.hasOwnProperty("bed")) {
                self.bedTemp["actual"](lastData.bed.actual);
                self.bedTemp["target"](lastData.bed.target);
            }

            if (lastData.hasOwnProperty("chamber")) {
                self.chamberTemp["actual"](lastData.chamber.actual);
                self.chamberTemp["target"](lastData.chamber.target);
            }

            if (!CONFIG_TEMPERATURE_GRAPH) return;

            self.temperatures = self._processTemperatureData(serverTime, data, self.temperatures);
        };

        self._processTemperatureHistoryData = function(serverTime, data) {
            self.temperatures = self._processTemperatureData(serverTime, data);
        };

        function arraysEqual(arr1, arr2) {
            if(arr1.length !== arr2.length)
                return false;
            for(var i = arr1.length; i--;) {
                if(arr1[i] !== arr2[i])
                    return false;
            }

            return true;
        }


        self._processTemperatureData = function(serverTime, data, result) {
            var types = _.keys(self.heaterOptions());
            var resultSize = types.length*2 + 1;
            var clientTime = Date.now();

            // make sure result is properly initialized
            if (!result) {
                result = [];
            }

            var newData = {x:[], y:[]};

            for(var i=1,len=0;i<resultSize  ;i++) {
                newData.x.push([])
                newData.y.push([])
            }


            for(var i=0,len=data.length;i<len;i++) {
                var d = data[i];
                var timeDiff = (serverTime - d.time) * 1000;
                var time = Math.round(clientTime - timeDiff);
                var tuple = [new Date(time)];

                _.each(types, function(type) {
                    if (d[type])
                    {
                        tuple.push(d[type].target);
                        tuple.push(d[type].actual);
                    }
                    else
                    {
                        tuple.push(NaN);
                        tuple.push(NaN);
                    }
                });
                if(tuple.length == resultSize)
                {
                    result.push(tuple);

                for(var j=1;j<tuple.length;j++) {
                    newData.x[j-1].push(tuple[0]);
                    newData.y[j-1].push(tuple[j]);
                }
                }
            }

            // todo : can be done in a more efficient matter, because result[0] is ordered
            var temperature_cutoff = self.temperature_cutoff();
            if (temperature_cutoff != undefined) {
                var filterOld = function(item) {
                    return item[0] >= clientTime - temperature_cutoff * 60 * 1000;
                };

                result = _.filter(result, filterOld);
            }

            // update plot
            if(self.plot) {
                var tracesToUpdate = []; // [0,1,2,3,...]
                for(var i=0;i<newData.x.length;i++) {
                    tracesToUpdate.push(i);
                }

                // update layout
                Plotly.extendTraces(self.plot, newData, tracesToUpdate, result.length)
            }

            return result;
        };

        self.getMaxTemp = function(actuals, targets) {
            var maxTemp = 310; // default minimum

            for(var i=0,len=0;i<self.temperatures.length;i++) {
                for(var j=1,len=0;j<self.temperatures[i].length;j++) {
                    maxTemp = Math.max(self.temperatures[i][j], maxTemp);
                }
            }
            return maxTemp;
        }

        self.onStartupComplete = function() {
            self._printerProfileUpdated();
        };

        self.onChangeBackgroundColor = function(val, useDefault) {
            var bgColor = useDefault ? self.defaultColors.background : self.backgroundColor();
            var relayout = {
                paper_bgcolor: bgColor,
                plot_bgcolor: bgColor
            }
            Plotly.relayout(self.plot, relayout);
        }

        self.onChangeAxisesColor = function(val, useDefault) {
            var aColor = useDefault ? self.defaultColors.axises : self.axisesColor();
            var relayout = {
                'xaxis.color': aColor,
                'yaxis.color': aColor
            }
            Plotly.relayout(self.plot, relayout);
        }

        self.onShowBackgroundImage = function(val, useDefault) {
            var relayout;
            if(!val)
            {
                relayout = {
                    'images': []
                }
            }
            else
            {
                relayout = {
                    images: [self.defaultImageData]
                }
            }
            Plotly.relayout(self.plot, relayout);
        }

        self.onStartWithAutoScale = function(val, useDefault) {
            var relayout = {
                'yaxis.autorange': val
            };
            if (!self.ownSettings.startWithAutoScale())
            {
                relayout['yaxis.range'] = [0, self.getMaxTemp()];
            }
            Plotly.relayout(self.plot, relayout);
        }

        self.onBeforeBinding = function() {
            self.ownSettings = self.settingsViewModel.settings.plugins.tempsgraph;
            self.backgroundColors = self.ownSettings.backgroundPresets;
            self.axisesColors = self.ownSettings.axisesPresets;
            self.selectedBackground = self.ownSettings.color.backgroundColor;
            self.selectedAxises = self.ownSettings.color.axisesColor;

            //Compute backgroundColor from preset and selected.
            self.backgroundColor = ko.computed({
                read: function() {
                    return self.ownSettings.backgroundPresets()
                    .find(function(preset) {
                        return preset.name() == self.selectedBackground();
                    }).value.extend({ rateLimit: 100})()
                },
                write: function(val) {
                    return self.ownSettings.backgroundPresets()
                    .find(function(preset) {
                        return preset.name() == self.selectedBackground();
                    }).value(val);
                }
            });
            //for color as well
            self.axisesColor = ko.computed({
                read: function() {
                    return self.ownSettings.axisesPresets()
                    .find(function(preset) {
                        return preset.name() == self.selectedAxises();
                    }).value();
                },
                write: function(val) {
                    return self.ownSettings.axisesPresets()
                    .find(function(preset) {
                        return preset.name() == self.selectedAxises();
                    }).value(val);
                }
            });
        }
        
        self.onSettingsShown = function() {
            //subscribe to handlers
            self.subscriptions.push(
                self.backgroundColor.subscribe(self.onChangeBackgroundColor),
                self.axisesColor.subscribe(self.onChangeAxisesColor),
                self.ownSettings.startWithAutoScale.subscribe(self.onStartWithAutoScale),
                self.ownSettings.showBackgroundImage.subscribe(self.onShowBackgroundImage));
        }

        self.onSettingsHidden = function() {
            //dispose of them
            self.subscriptions.map(function(elem, i) {
                elem.dispose();
            });
        }
    }

    // view model class, parameters for constructor, container to bind to
    OCTOPRINT_VIEWMODELS.push({
        construct: TempsgraphViewModel,
        dependencies: ["loginStateViewModel", "settingsViewModel"],
        elements: ["#settings_plugin_tempsgraph"]
    });

});

