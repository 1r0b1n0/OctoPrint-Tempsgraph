/*
 * View model for OctoPrint-tempsgraph
 *
 * Author: Robin
 * License: AGPLv3
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

        self.heaterOptions = ko.observable({});
        self.prevHeaterKeys = "";

        self._printerProfileInitialized = false;
        self._currentTemperatureDataBacklog = [];
        self._historyTemperatureDataBacklog = [];

        self.showFahrenheit = false;
        self.temperatures = [];

        self.plot = null; // dygraph

        self._printerProfileUpdated = function() {
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

            self.updatePlot();
        };
        self.settingsViewModel.printerProfiles.currentProfileData.subscribe(function() {
            self._printerProfileUpdated();
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

            self.plot = document.getElementById("div_g");
            var data = [];
            var heaterKeys = _.keys(self.heaterOptions())
            var heaterOptions = self.heaterOptions()

            for(var i=0;i<heaterKeys.length;i++) {
                data.push({
                    x: [],
                    y: [],
                    type: 'scatter',
                    line: {
                        width: 8.0,
                        color: pusher.color(heaterOptions[heaterKeys[i]].color).tint(0.8).html()
                    },
                    name: heaterKeys[i]+"_target"
                });
                data.push({
                    x: [],
                    y: [],
                    type: 'scatter',
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
                showgrid: false,
                zeroline: false
              },
              yaxis: {
                showline: false
              },
              margin: {
                l: 30,
                r: 30,
                b: 50,
                t: 30,
                pad: 4
              },
              showlegend: false,
              //legend: {"orientation": "h", y: 1}
            };
            Plotly.plot(self.plot, data, layout);

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
            self.updatePlot();
        };

        self._processTemperatureHistoryData = function(serverTime, data) {
            self.temperatures = self._processTemperatureData(serverTime, data);
            self.updatePlot();
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
                    if (!d[type]) return;
                    tuple.push(d[type].target);
                    tuple.push(d[type].actual);
                });
                if(tuple.length == resultSize)
                {
                    result.push(tuple);
                }

                for(var j=1;j<tuple.length;j++) {
                    newData.x[j-1].push(tuple[0]);
                    newData.y[j-1].push(tuple[j]);
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
            if(self.plot)
            {
                Plotly.extendTraces(self.plot, newData, [0,1,2,3], result.length)
            }

            return result;
        };


        self.updatePlot = function() {
            // plotly.js doesn't need any update
        };

        self.getMaxTemp = function(actuals, targets) {
            var pair;
            var maxTemp = 0;
            actuals.forEach(function(pair) {
                if (pair[1] > maxTemp){
                    maxTemp = pair[1];
                }
            });
            targets.forEach(function(pair) {
                if (pair[1] > maxTemp){
                    maxTemp = pair[1];
                }
            });
            return maxTemp;
        };

        self.setTarget = function(item) {
            var value = item.newTarget();
            if (!value) return;

            var onSuccess = function() {
                item.newTarget("");
            };

            if (item.key() == "bed") {
                self._setBedTemperature(value)
                    .done(onSuccess);
            } else {
                self._setToolTemperature(item.key(), value)
                    .done(onSuccess);
            }
        };

        self.setTargetFromProfile = function(item, profile) {
            if (!profile) return;

            var onSuccess = function() {
                item.newTarget("");
            };

            if (item.key() == "bed") {
                self._setBedTemperature(profile.bed)
                    .done(onSuccess);
            } else {
                self._setToolTemperature(item.key(), profile.extruder)
                    .done(onSuccess);
            }
        };

        self.setTargetToZero = function(item) {
            var onSuccess = function() {
                item.newTarget("");
            };

            if (item.key() == "bed") {
                self._setBedTemperature(0)
                    .done(onSuccess);
            } else {
                self._setToolTemperature(item.key(), 0)
                    .done(onSuccess);
            }
        };

        self.setOffset = function(item) {
            var value = item.newOffset();
            if (!value) return;

            var onSuccess = function() {
                item.newOffset("");
            };

            if (item.key() == "bed") {
                self._setBedOffset(value)
                    .done(onSuccess);
            } else {
                self._setToolOffset(item.key(), value)
                    .done(onSuccess);
            }
        };

        self._setToolTemperature = function(tool, temperature) {
            var data = {};
            data[tool] = parseInt(temperature);
            return OctoPrint.printer.setToolTargetTemperatures(data);
        };

        self._setToolOffset = function(tool, offset) {
            var data = {};
            data[tool] = parseInt(offset);
            return OctoPrint.printer.setToolTemperatureOffsets(data);
        };

        self._setBedTemperature = function(temperature) {
            return OctoPrint.printer.setBedTargetTemperature(parseInt(temperature));
        };

        self._setBedOffset = function(offset) {
            return OctoPrint.printer.setBedTemperatureOffset(parseInt(offset));
        };

        self.handleEnter = function(event, type, item) {
            if (event.keyCode == 13) {
                if (type == "target") {
                    self.setTarget(item);
                } else if (type == "offset") {
                    self.setOffset(item);
                }
            }
        };

        self.onAfterTabChange = function(current, previous) {
            if (current != "#tab_plugin_tempsgraph") {
                return;
            }
            if(self.plot)
            {
                // if tab was hidden, we might need a refresh
                self.updatePlot();
            }

        };

        self.onStartupComplete = function() {
            self._printerProfileUpdated();
        };

    }

    // view model class, parameters for constructor, container to bind to
    OCTOPRINT_VIEWMODELS.push([
        TempsgraphViewModel,

        // e.g. loginStateViewModel, settingsViewModel, ...
        [ "loginStateViewModel", "settingsViewModel"],

        // e.g. #settings_plugin_tempv2, #tab_plugin_tempv2, ...
        [ "#tab_plugin_tempsgraph" ]
    ]);

});

