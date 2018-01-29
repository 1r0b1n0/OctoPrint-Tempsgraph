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
                offset: ko.observable(0),
                newTarget: ko.observable(),
                newOffset: ko.observable()
            }
        };

        self.tools = ko.observableArray([]);
        self.hasBed = ko.observable(true);
        self.bedTemp = self._createToolEntry();
        self.bedTemp["name"](gettext("Bed"));
        self.bedTemp["key"]("bed");

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

        self.plot = null; // dygraph
        
        self.subscriptions = [];

        self._printerProfileUpdated = function() {
            console.log("UPDATE")
            console.log(self)
            console.log(self._bound)
            var graphColors = ["red", "orange", "green", "brown", "purple"];
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
                tools[0]["name"](gettext("Hotend"));
                tools[0]["key"]("tool0");
            }

            // print bed
            if (currentProfileData && currentProfileData.heatedBed()) {
                self.hasBed(true);
                heaterOptions["bed"] = {name: gettext("Bed"), color: "blue"};
            } else {
                self.hasBed(false);
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
            self.settingsViewModel.printerProfiles.currentProfileData().heatedBed.subscribe(self._printerProfileUpdated);
        });

        self.fromCurrentData = function(data) {
            self._processStateData(data.state);
            if (!self._printerProfileInitialized) {
                self._currentTemperatureDataBacklog.push(data);
            } else {
                self._processTemperatureUpdateData(data.serverTime, data.temps);
            }
            self._processOffsetData(data.offsets);
        };

        self.fromHistoryData = function(data) {
            self._processStateData(data.state);
            if (!self._printerProfileInitialized) {
                self._historyTemperatureDataBacklog.push(data);
            } else {
                self._processTemperatureHistoryData(data.serverTime, data.temps);
            }
            self._processOffsetData(data.offsets);
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
            
            var bodyBgColor = $('body').css('backgroundColor');
            var legendColor = null;
            if(self.ownSettings && self.ownSettings.enableCustomization()) {
                if(self.selectedBackground && self.selectedBackground() != "Default") {
                    console.log(self.backgroundColor())
                    bodyBgColor = self.backgroundColor();
                }
                if(self.selectedLegend && self.selectedLegend() != "Default") {
                    legendColor = self.legendColor();
                }
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
                    color: legendColor
                  },
                  yaxis: {
                    range: [0, self.getMaxTemp()],
                    linecolor: 'gray',
                    linewidth: 1,
                    mirror: true,
                    color: legendColor
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
                }
            }

            if (lastData.hasOwnProperty("bed")) {
                self.bedTemp["actual"](lastData.bed.actual);
                self.bedTemp["target"](lastData.bed.target);
            }

            if (!CONFIG_TEMPERATURE_GRAPH) return;

            self.temperatures = self._processTemperatureData(serverTime, data, self.temperatures);
        };

        self._processTemperatureHistoryData = function(serverTime, data) {
            self.temperatures = self._processTemperatureData(serverTime, data);
        };

        self._processOffsetData = function(data) {
            var tools = self.tools();
            for (var i = 0; i < tools.length; i++) {
                if (data.hasOwnProperty("tool" + i)) {
                    tools[i]["offset"](data["tool" + i]);
                }
            }

            if (data.hasOwnProperty("bed")) {
                self.bedTemp["offset"](data["bed"]);
            }
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
            console.log("STARTUP")
            self._printerProfileUpdated();
        };

        self.onChangeBackground = function(val) {
            var relayout = {
                paper_bgcolor: self.backgroundColor(),
                plot_bgcolor: self.backgroundColor()
            }
            console.log(relayout)
            Plotly.relayout(self.plot, relayout);
        }

        self.onChangeLegend = function() {
            var relayout = {
                'xaxis.color': self.legendColor(),
                'yaxis.color': self.legendColor()
            }
            console.log(relayout)
            Plotly.relayout(self.plot, relayout);
        }

        self.onChangeSelected = function(val) {
            self.backgroundColor("test")
        }

        self.onBeforeBinding = function() {
            self.ownSettings = self.settingsViewModel.settings.plugins.tempsgraph;
            self.backgroundColors = self.ownSettings.backgroundPresets;
            self.legendColors = self.ownSettings.legendPresets;
            console.log(self.ownSettings)
            self.selectedBackground = self.ownSettings.color.backgroundColor;
            self.selectedLegend = self.ownSettings.color.legendColor;
            
            
            //Observable that returns another observable!
            self.backgroundColor = ko.computed(function() {
                return self.ownSettings.backgroundPresets()
                    .find(function(preset) {
                        return preset.name() == self.selectedBackground();
                    }).value.extend({ rateLimit: 100});
            }).extend({ rateLimit: 100, notify: 'always'})().extend({notify: 'always'})
    
            self.legendColor = ko.computed(function(val) {
                console.log(val)
                return self.ownSettings.legendPresets()
                    .find(function(preset) {
                        return preset.name() == self.selectedLegend();
                    }).value;
            }).extend({ rateLimit: 100, notify: 'always'})();
    
        }

        self.onSettingsShown = function() {
            //subscribe to handlers
            self.subscriptions.push(self.selectedBackground.subscribe(self.onChangeSelected),
                self.selectedLegend.subscribe(self.onChangeSelected),
                self.backgroundColor.subscribe(self.onChangeBackground), 
                self.legendColor.subscribe(self.onChangeLegend));
        }

        self.onSettingsHidden = function() {
            self.subscriptions.map(function(elem, i) {
                elem.dispose();
            });
        }
    }

    // view model class, parameters for constructor, container to bind to
    OCTOPRINT_VIEWMODELS.push([
        TempsgraphViewModel,

        // e.g. loginStateViewModel, settingsViewModel, ...
        [ "loginStateViewModel", "settingsViewModel"],

        // e.g. #settings_plugin_tempv2, #tab_plugin_tempv2, ...
        ["#settings_plugin_tempsgraph"]
    ]);

});

