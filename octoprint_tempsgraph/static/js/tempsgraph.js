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
        self.prevHeaterKeys = [];

        self._printerProfileInitialized = false;
        self._currentTemperatureDataBacklog = [];
        self._historyTemperatureDataBacklog = [];

        self.g = null; // dygraph

        self._printerProfileUpdated = function() {
            var graphColors = ["red", "orange", "green", "brown", "purple"];
            var heaterOptions = {};
            var tools = self.tools();
            var color;

            // reset previous data
            //self.temperatures = [];

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

            if (!self._printerProfileInitialized) {
                self._triggerBacklog();
            }

            // update graph data
            var labels = ["time"];
            var initialData = [0];
            var colors = [];
            var typesKeys = _.keys(self.heaterOptions());
            for(var i=0 ; i<typesKeys.length ; i++)
            {
                var type = typesKeys[i];
                labels.push(type + "_actual");
                labels.push(type + "_target");
                initialData.push(0);
                initialData.push(0);
                colors.push(heaterOptions[type].color);
                colors.push(pusher.color(heaterOptions[type].color).tint(0.5).html());
            }
            for(var i=0 ; i<typesKeys.length ; i++)
            {
                colors
            }

            self.g.updateOptions( {'file': [initialData], 'labels': labels, 'colors': colors} );


            self.updatePlot();
        };
        self.settingsViewModel.printerProfiles.currentProfileData.subscribe(function() {
            self._printerProfileUpdated();
            self.settingsViewModel.printerProfiles.currentProfileData().extruder.count.subscribe(self._printerProfileUpdated);
            self.settingsViewModel.printerProfiles.currentProfileData().heatedBed.subscribe(self._printerProfileUpdated);
        });

        self.temperatures = [];

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

            // init dygraphs
            self.g = new Dygraph(
              document.getElementById("div_g"),
              [[0,0]],
              {
                labelsDiv: document.getElementById('status'),
                labelsSeparateLines: true,
                labelsKMB: true,
                legend: 'always',
                /*colors: ["rgb(51,204,204)",
                         "rgb(255,100,100)",
                         "rgb(255,0,0)",
                         "rgb(255,0,255)",
                         "rgb(255,255,0)"],*/
                width: 500,
                height: 400,
                labels: ['',''],
                //xlabel: 'Date',
                //ylabel: 'Temp',
                //yRangePad: 100,
                //includeZero: true,
                valueRange: [0.0, 300],
                strokeWidth: 4.0,
                axisLineColor: 'white',
                labelsDiv: document.getElementById('legend'),
                axes: {
                  x: {
                    valueFormatter: function(t) {
                      return new Date(t).toISOString();
                    }
                  },
                  y: {
                    valueFormatter: function(t) {
                      return parseFloat(t).toFixed(1) + " °C";
                    }
                  }
                }
                //showRangeSelector: true
                // drawXGrid: false
              }
            );
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
            // result format : [[local_timestamp, tool1_actual, tool1_target, bed_actual, bed_target, ...],]
            // result format : [[local_timestamp, type[0].actual, type[0].target, type[1].actual, type[1].target, ...],]

            var types = _.keys(self.heaterOptions());
            var resultSize = types.length*2 + 1;
            var clientTime = Date.now();

            // make sure result is properly initialized
            if (!result) {
                result = [];
            }

            // convert data
            for(var i=0,len=data.length;i<len;i++) {
                var d = data[i];
                var timeDiff = (serverTime - d.time) * 1000;
                var time = Math.round(clientTime - timeDiff);
                var tuple = [new Date(time)];
                _.each(types, function(type) {
                    if (!d[type]) return;
                    tuple.push(d[type].actual);
                    tuple.push(d[type].target);
                });
                if(tuple.length == resultSize)
                {
                    result.push(tuple);
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

            return result;
        };

        self.updatePlot = function() {
            console.log("updating")
            if(!self.g)
                return;

            var clientTime = Date.now();

            if(self.temperatures.length == 0)
            {
                var els = _.keys(self.heaterOptions()).length*2 + 1;
                var data = [];
                for(var i=0;i<els;i++)
                    data.push(0)

                self.g.updateOptions( { 'file': [data] } );
            }
            else
            {
                var data = [];
/*
                // we shouldn't use a foreach here : http://jsperf.com/fast-array-foreach
                for(var i=0, len=self.temperatures.length; i < len ; i++){
                    var d = self.temperatures[i];
                    //var time = d[0] - clientTime;
                    var time = clientTime;

                    tuple = [time]
                    for (var j = 1; j < d.length; j++) {
                        tuple.push(d[j])
                    }
                    data.push(tuple)
                }
                */

                data = self.temperatures;

                var oldValueRange = [0, 300];
                if(self.g.axes_[0] && self.g.axes_[0].computedValueRange)
                    oldValueRange = self.g.axes_[0].computedValueRange

                self.g.updateOptions( { 'file': data, 'valueRange': oldValueRange } );
            }

        /*
            var graph = $("#temperature-graph");
            if (graph.length) {
                var data = [];
                var heaterOptions = self.heaterOptions();
                if (!heaterOptions) return;

                var maxTemps = [310/1.1];

                _.each(_.keys(heaterOptions), function(type) {
                    if (type == "bed" && !self.hasBed()) {
                        return;
                    }

                    var actuals = [];
                    var targets = [];

                    if (self.temperatures[type]) {
                        actuals = self.temperatures[type].actual;
                        targets = self.temperatures[type].target;
                    }

                    var showFahrenheit = (self.settingsViewModel.settings !== undefined )
                                         ? self.settingsViewModel.settings.appearance.showFahrenheitAlso()
                                         : false;
                    var actualTemp = actuals && actuals.length ? formatTemperature(actuals[actuals.length - 1][1], showFahrenheit) : "-";
                    var targetTemp = targets && targets.length ? formatTemperature(targets[targets.length - 1][1], showFahrenheit) : "-";

                    data.push({
                        label: gettext("Actual") + " " + heaterOptions[type].name + ": " + actualTemp,
                        color: heaterOptions[type].color,
                        data: actuals
                    });
                    data.push({
                        label: gettext("Target") + " " + heaterOptions[type].name + ": " + targetTemp,
                        color: pusher.color(heaterOptions[type].color).tint(0.5).html(),
                        data: targets
                    });

                    maxTemps.push(self.getMaxTemp(actuals, targets));
                });

                self.plotOptions.yaxis.max = Math.max.apply(null, maxTemps) * 1.1;
                $.plot(graph, data, self.plotOptions);
            }
            */


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
            if(self.g)
            {

                setTimeout($.proxy(function(){self.g.resize()}, this), 0)
                //$(window).trigger('resize');
            }
            self.updatePlot();
        };

        self.onStartupComplete = function() {
            self._printerProfileUpdated();
        };

    }


/*
        self.fromHistoryData = function(data) {
            console.log("From history")
            temps = data.temps;
            var clientTime = Date.now();
            var serverTime = data.serverTime;

            data = [];

            $.each(temps, function(i,d) {
                var timeDiff = -(serverTime - d.time);
                var time = clientTime - timeDiff;

                if(d.hasOwnProperty("tool0"))
                {
                    tuple = [timeDiff, d['tool0'].actual, d['tool0'].target]
                    data.push(tuple)
                }
                });


            g = new Dygraph(
              document.getElementById("div_g"),
              data,
              {
                labelsDiv: document.getElementById('status'),
                labelsSeparateLines: true,
                labelsKMB: true,
                legend: 'always',
                colors: ["rgb(51,204,204)",
                         "rgb(255,100,100)",
                         "rgb(255,0,0)"],
                width: 500,
                height: 400,
                //xlabel: 'Date',
                //ylabel: 'Temp',
                //yRangePad: 100,
                includeZero: true,
                valueRange: [0.0, 300],
                axisLineColor: 'white',
                labelsDiv: document.getElementById('legend'),
                axes: {
                  x: {
                    valueFormatter: function(t) {
                      return parseFloat(t).toFixed(1) + " s";
                    }
                  },
                  y: {
                    valueFormatter: function(t) {
                      return parseFloat(t).toFixed(1) + " °C";
                    }
                  }
                }
                //showRangeSelector: true
                // drawXGrid: false
              }
            );
        }
    }
    */

    // view model class, parameters for constructor, container to bind to
    OCTOPRINT_VIEWMODELS.push([
        TempsgraphViewModel,

        // e.g. loginStateViewModel, settingsViewModel, ...
        [ "loginStateViewModel", "settingsViewModel"],

        // e.g. #settings_plugin_tempv2, #tab_plugin_tempv2, ...
        [ "#tab_plugin_tempsgraph" ]
    ]);

    // init graph

/*    g = new Dygraph(
              document.getElementById("div_g"),
              function() {
                var zp = function(x) { if (x < 10) return "0"+x; else return x; };
                var r = "date,parabola,line,another line,sine wave\n";
                for (var i=1; i<=31; i++) {
                r += "200610" + zp(i);
                r += "," + 10*(i*(31-i));
                r += "," + 10*(8*i);
                r += "," + 10*(250 - 8*i);
                r += "," + 10*(125 + 125 * Math.sin(0.3*i));
                r += "\n";
                }
                return r;
              },
              {
                labelsDiv: document.getElementById('status'),
                labelsSeparateLines: true,
                labelsKMB: true,
                legend: 'always',
                colors: ["rgb(51,204,204)",
                         "rgb(255,100,100)",
                         "#00DD55",
                         "rgba(50,50,200,0.4)"],
                width: 600,
                height: 300,
                title: 'Interesting Shapes',
                xlabel: 'Date',
                ylabel: 'Count',
                axisLineColor: 'white',
                showRangeSelector: true
                // drawXGrid: false
              }
          );
          */

});

