var async = require('async');
var models = require('./models');
var riot_api = require('./riot_api');

var MatchQueueItem = models.MatchQueueItem;
var MatchCacheItem = models.MatchCacheItem;
var MatchProcessed = models.MatchProcessed;
var StatCollection = models.StatCollection;
var MatchFrameData = models.MatchFrameData;

var ITEM_HEALTH_POTION = 2003;
var ITEM_MANA_POTION = 2004;

var ConsumableItemIds = [ 2003,   // Health Potion
                          2004,   // Mana Potion
                          2009,   // Total Biscuit of Regeneration
                          2010,   // (Also Biscuit?)
                          2043,   // Vision Ward
                          2044    // Stealth Ward
                        ]  

var TrinketItemIds = [ 3340,   // Warding Totem
                       3341,   // Sweeping Lens
                       3342,   // Scrying Orb
                       3361,   // Greater Stealth Totem
                       3362,   // Greater Vision Totem
                       3363,   // Farsight Orb
                       3364,   // Oracle's Lens
                     ] 

function AggregateStats() {
    this.gameTime = 0;
    this.samples = 0;
    //this.mergedTotalGold = 0;
    //this.mergedCurrentGold = 0;
    //this.healthPotsUsed = 0;
    //this.manaPotsUsed = 0;
    //this.trinketWardsPlaced = 0;
    //this.visionWardsPlaced = 0;
    //this.sightWardsPlaced = 0;
    this.kills = 0;
    this.assists = 0;
    this.deaths = 0;
    //this.dragon = 0;
    //this.baron = 0;

    //this.frameGold = 0;
    //this.frameMinionsKilled = 0;
    //this.frameJungleMinionsKilled = 0;
}

function mergeStat(thisStat, thisSamples, otherStat, otherSamples) {
    return (otherStat * otherSamples + thisStat * thisSamples) / (otherSamples + thisSamples);
}

AggregateStats.prototype.mergeSamples = function(otherStats){
    //this.mergedTotalGold = mergeStat(this.mergedTotalGold, this.samples, otherStats.mergedTotalGold, otherStats.samples);
    //this.mergedCurrentGold = mergeStat(this.mergedCurrentGold, this.samples, otherStats.mergedCurrentGold, otherStats.samples);
    //this.healthPotsUsed += otherStats.healthPotsUsed;
    //this.manaPotsUsed += otherStats.manaPotsUsed;
    //this.trinketWardsPlaced += otherStats.trinketWardsPlaced;
    //this.visionWardsPlaced += otherStats.visionWardsPlaced;
    //this.sightWardsPlaced += otherStats.sightWardsPlaced;
    this.kills += otherStats.kills;
    this.assists += otherStats.assists;
    this.deaths += otherStats.deaths;
    //this.dragon += otherStats.dragon;
    //this.baron += otherStats.baron;
    //this.frameGold = mergeStat(this.frameGold, this.samples, otherStats.frameGold, otherStats.samples);
    //this.frameMinionsKilled = mergeStat(this.frameMinionsKilled, this.samples, otherStats.frameMinionsKilled, otherStats.samples);
    //this.frameJungleMinionsKilled = mergeStat(this.frameJungleMinionsKilled, this.samples, otherStats.frameJungleMinionsKilled, otherStats.samples);

/*
    for (i in otherStats.items) {
        if (this.items[i] == undefined) {
            this.items[i] = otherStats.items[i];
        } else {
            //this.items[i].quantity += otherStats.items[i].quantity;
            this.items[i].frequency += otherStats.items[i].frequency;
        }
    }
*/

    this.samples = this.samples + otherStats.samples;
}

// {{item_id}}: quantity => {{item_id}}: {quantity, frequency}

/*
function PrepareItems(items){
    // Add prefix of quantity to item_id
    var newItems = {};
    for (var i in items) {
        var qty_item_id = parseInt(i) + (items[i] * 10000); // QIIII: Q = quantity, IIII = item_id
        newItems[qty_item_id] = { quantity: items[i], frequency: 1 };
    }
    return newItems;
}*/

function GetTrinketIdAndRemove(items) {
    for (var i in items) {
        if (TrinketItemIds.indexOf(parseInt(i)) > -1) {
            delete items[i];
            return i;
        }
    }
}

function RemoveConsumables(items) {
    for (var i in items) {
        if (ConsumableItemIds.indexOf(parseInt(i)) > -1) {
            delete items[i];
        }
    }
}

function GetQuantityItemIdString(items){
    // Add prefix of quantity to item_id
    var qty_item_array = [];
    for (var i in items) {
        var qty_item_id = parseInt(i) + (items[i] * 10000); // QIIII: Q = quantity, IIII = item_id
        qty_item_array.push(qty_item_id);
    }

    var item_build_string = '';
    qty_item_array.sort()
                  .forEach(function(v) {
                     item_build_string += v+':';
                  });

    return item_build_string;
}

function ParticipantState(){
    this.items = {};
    this.health_pots_used = 0;
    this.mana_pots_used = 0;
    this.trinket_wards_placed = 0;
    this.vision_wards_placed = 0;
    this.sight_wards_placed = 0;

    this.kills = 0;
    this.assists = 0;
    this.deaths = 0;

    this.dragon = 0;
    this.baron = 0;
}

ParticipantState.prototype.frameReset = function() {
    this.health_pots_used = 0;
    this.mana_pots_used = 0;
    this.trinket_wards_placed = 0;
    this.vision_wards_placed = 0;
    this.sight_wards_placed = 0;

    this.kills = 0;
    this.assists = 0;
    this.deaths = 0;

    this.dragon = 0;
    this.baron = 0;
}

function ParticipantRecord(){
    this.state = null;
    this.timestamp = null;
    this.pframe = null;
}

ParticipantState.prototype.addItem = function(item_id) {
    if (this.items[item_id] == undefined) {
        this.items[item_id] = 1;
    } else {
        this.items[item_id]++;
    }
}

ParticipantState.prototype.removeItem = function(item_id) {
    if (this.items[item_id] > 1) {
        this.items[item_id]--;
    } else {
        delete this.items[item_id];
    }
}

ParticipantState.prototype.handleItemEvent = function(event) {
    var thisInventoryItemId = this.items[event.itemId];
    switch(event.eventType) {
        case 'ITEM_PURCHASED':
            this.addItem(event.itemId);
            break;
        case 'ITEM_SOLD':
            this.removeItem(event.itemId);
            break;
        case 'ITEM_UNDO':
            this.removeItem(event.itemBefore);
            if (event.itemAfter > 0) {
                this.addItem(event.itemAfter);
            }
            break;
        case 'ITEM_DESTROYED':
            switch(event.itemId) {
                case ITEM_HEALTH_POTION:
                    this.health_pots_used++;
                    break;
                case ITEM_MANA_POTION:
                    this.mana_pots_used++;
                    break;
            }
            // Check for consumables here
            this.removeItem(event.itemId);
            break;
        case 'WARD_PLACED':
            switch (event.wardType) {
                case 'YELLOW_TRINKET':
                case 'YELLOW_TRINKET_UPGRADE':
                    this.trinket_wards_placed++;
                    break;
                case 'SIGHT_WARD':
                    this.sight_wards_placed++;
                    break;
                case 'VISION_WARD':
                    this.vision_wards_placed++;
                    break;
                case 'UNDEFINED':
                    // Happens with Wolf Spirit / Farsight Orb, do nothing
                case 'TEEMO_MUSHROOM':
                    break;
                default:
                    console.log('[ERROR] Unknown ward type: '+event.wardType);
            }
            break;
        case 'SKILL_LEVEL_UP':
            // Don't do anything with this for now
            break;
        default:
            // If we don't know what event this is, just ignore it
    }
}

ParticipantState.prototype.handleKillEvent = function(event) {
    switch (event.eventType) {
        case 'CHAMPION_KILL':
            this.kills++;
            break;
        case 'ELITE_MONSTER_KILL':
            if (event.monsterType == 'DRAGON') {
                this.dragon++;
            } else if (event.monsterType == 'BARON') {
                this.baron++;
            }
            break;
        default:
    }
}

ParticipantState.prototype.handleVictimEvent = function(event) {
    switch (event.eventType) {
        case 'CHAMPION_KILL':
            this.deaths++;
            break;
        default:
    }
}

ParticipantState.prototype.handleAssistEvent = function(event) {
    switch (event.eventType) {
        case 'CHAMPION_KILL':
            this.assists++;
            break;
        case 'ELITE_MONSTER_KILL':
            if (event.monsterType == 'DRAGON') {
                this.dragon++;
            } else if (event.monsterType == 'BARON') {
                this.baron++;
            }
            break;
        default:
    }
}

function recordSnapshot(timestamp, state_history, p_frames, participant_states) {
    for (var p in participant_states) {
        var pRecord = new ParticipantRecord();
        pRecord.timestamp = timestamp;
        pRecord.state = participant_states[p];
        pRecord.pframe = p_frames[p];

        // Convert to/from JSON so we can actually save our ParticipantRecord
        // *** Replace ParticipantRecord altogether with {} object here?
        state_history[p].push(JSON.parse(JSON.stringify(pRecord)));

        pRecord.state.frameReset();
    }
}

function recordProcessed(matchId, callback){
    // Update the MatchQueueItem so we don't process this match again
    MatchProcessed.update({ _id: matchId },
                          { _id: matchId },
                          { upsert: true },
                          function(error)
                          {
                            if (error) {
                                console.log(error);
                            } else {
                                console.log('[PROCESSED] Match '+matchId);
                                callback();
                            }
                          });
}

function processStateHistory(json_data, state_history, tier, callback) {
    var matched_json = false;
    var winning_team = 0;

    if (json_data.teams[0].winner) {
        winning_team = json_data.teams[0].teamId;
    } else {
        winning_team = json_data.teams[1].teamId;
    }

    async.each(json_data.participants, function(json_p, next_p) {
        var victory = (json_p.teamId == winning_team) ? true : false;
        var participant_history = state_history[json_p.participantId];
        var truncated_patch = json_data.matchVersion.split('.',2).join('.');

        StatCollection.findOne({ championId: json_p.championId,
                                 tier: tier,
                                 victory: victory,
                                 patch: truncated_patch,
                                 lane: json_p.timeline.lane,
                                 role: json_p.timeline.role },
            function(error, stat_collection){
                if (error) {
                    console.log(error);
                } else {
                    if (!stat_collection) {
                        stat_collection = new StatCollection();
                        stat_collection.championId = json_p.championId;
                        stat_collection.tier = tier;
                        stat_collection.victory = victory;
                        stat_collection.patch = truncated_patch;
                        stat_collection.lane = json_p.timeline.lane;
                        stat_collection.role = json_p.timeline.role;
                        stat_collection.samples = 0;
                        stat_collection.aggregateStats = [];
                        stat_collection.itemBuilds = {};
                        stat_collection.trinketBuilds = {};
                    } else { 
                        for (var j=0; j<stat_collection.matchFrameData.length; j++) {
                            if (stat_collection.matchFrameData[j]._id == json_data.matchId) {
                                console.log('[ERROR] This match has already been added: ');
                                next_p();
                            }
                        }
                    }

                    // Add rest of frame data
                    var match_frame_data = new MatchFrameData();
                    match_frame_data._id = json_data.matchId;

                    for (var j=0; j<participant_history.length; j++) {
                        /*
                        if (participant_history[j].pframe.position) {
                            var this_coord = {};
                            this_coord.x = participant_history[j].pframe.position.x;
                            this_coord.y = participant_history[j].pframe.position.y;
                            match_frame_data.coords.push({ x: this_coord.x, y: this_coord.y });
                        }
                        */

                        var p_history = participant_history[j];

                        var aggregate_frame = new AggregateStats();

                        aggregate_frame.gameTime = Math.floor(p_history.timestamp/60000);
                        aggregate_frame.samples = 1;
                        //aggregate_frame.totalGold = p_history.pframe.totalGold;
                        //aggregate_frame.currentGold = p_history.pframe.currentGold;
                        //aggregate_frame.healthPotsUsed = p_history.state.health_pots_used;
                        //aggregate_frame.manaPotsUsed = p_history.state.mana_pots_used;
                        //aggregate_frame.trinketWardsPlaced = p_history.state.trinket_wards_placed;
                        //aggregate_frame.visionWardsPlaced = p_history.state.vision_wards_placed;
                        //aggregate_frame.sightWardsPlaced = p_history.state.sight_wards_placed;
                        //aggregate_frame.items = PrepareItems(p_history.state.items);
                        aggregate_frame.kills = p_history.state.kills;
                        aggregate_frame.assists = p_history.state.assists;
                        aggregate_frame.deaths = p_history.state.deaths;
                        //aggregate_frame.dragon = p_history.state.dragon;
                        //aggregate_frame.baron = p_history.state.baron;

                        if (j > 0) {
                            // Calculate frame delta stats
                            var last_frame = participant_history[j-1];
                            //aggregate_frame.frameGold = p_history.pframe.totalGold - last_frame.pframe.totalGold;
                            //aggregate_frame.frameMinionsKilled = p_history.pframe.minionsKilled - last_frame.pframe.minionsKilled;
                            //aggregate_frame.frameJungleMinionsKilled = p_history.pframe.jungleMinionsKilled - last_frame.pframe.jungleMinionsKilled;

                            // Save starting items in inventory
                            if (j == 1 || j%5 == 0) {
                                if (j != 1) {
                                    RemoveConsumables(p_history.state.items);
                                }

                                var trinket_build_id = GetTrinketIdAndRemove(p_history.state.items);
                                var item_build_string = GetQuantityItemIdString(p_history.state.items); // Grab all items for first build
                                // Record this build into the stat_collection
                                if (!stat_collection.itemBuilds[j]) {
                                    stat_collection.itemBuilds[j] = {};
                                }

                                if (stat_collection.itemBuilds[j][item_build_string]) {
                                    stat_collection.itemBuilds[j][item_build_string]++;
                                } else {
                                    stat_collection.itemBuilds[j][item_build_string] = 1;
                                }

                                // Record this build into the stat_collection
                                if (!stat_collection.trinketBuilds[j]) {
                                    stat_collection.trinketBuilds[j] = {};
                                }

                                if (stat_collection.trinketBuilds[j][trinket_build_id]) {
                                    stat_collection.trinketBuilds[j][trinket_build_id]++;
                                } else {
                                    stat_collection.trinketBuilds[j][trinket_build_id] = 1;
                                }
                            }
                        }

                        if (stat_collection.aggregateStats[j] != undefined) {
                            aggregate_frame.mergeSamples(stat_collection.aggregateStats[j]);
                        }

                        stat_collection.aggregateStats[j] = aggregate_frame;
                    }

                    stat_collection.matchFrameData.push(match_frame_data);

                    stat_collection.markModified('aggregateStats');
                    stat_collection.markModified('itemBuilds');
                    stat_collection.markModified('trinketBuilds');
                    stat_collection.samples++;
                    stat_collection.save(
                        function(error)
                        {
                            if (error) {
                                // TODO: Add __v (version) to document?
                                // { [VersionError: No matching document found.]
                                //      stack: [Getter/Setter],
                                //      message: 'No matching document found.',
                                //      name: 'VersionError' }
                                console.log(error);
                            }
                            
                            next_p();
                        });
            } // close "fineOne(function)"
        }); // close "findOne"
        // TEST BUILD MATCHES FINAL BUILD
    }, function(){ recordProcessed(json_data.matchId, callback); });
}

function processFrames(json_data, tier, callback) {
    if (json_data.timeline) {
        var state_history = {};
        var participant_states = {};
        json_data.participants.forEach( function(participant) {
            participant_states[participant.participantId] = new ParticipantState();
            state_history[participant.participantId] = [];
        });

        for (var i=0; i<json_data.timeline.frames.length; i++) {
            frame = json_data.timeline.frames[i];
            var p_frames = frame.participantFrames;

            if (frame.events) {
                for (var j=0; j<frame.events.length; j++) {
                    var event = frame.events[j];

                    var p_id;
                    if (event.participantId != undefined || event.creatorId != undefined) {
                        if (event.creatorId != undefined) {
                            p_id = event.creatorId;
                        } else {
                            p_id = event.participantId;
                        }

                        if (p_id != 0) {
                            participant_states[p_id].handleItemEvent(event);
                        }
                    } else if (event.killerId != undefined) {
                        if (event.killerId != 0) {
                            participant_states[event.killerId].handleKillEvent(event);
                        }

                        if (event.victimId != undefined) {
                            participant_states[event.victimId].handleVictimEvent(event);
                        }

                        if (event.assistingParticipantIds) {
                            for (var k=0; k<event.assistingParticipantIds.length; k++) {
                                participant_states[event.assistingParticipantIds[k]].handleAssistEvent(event);
                            }
                        }
                    }
                }
            }

            recordSnapshot(frame.timestamp, state_history, p_frames, participant_states);
        }

        // Verify and record results
        processStateHistory(json_data, state_history, tier, callback);
    } else {
        console.log('[ERROR] No timeline data for this match: '+json_data.matchId);
        callback();
    }
}

function selectMatch() {
    console.log('[INFO] Selecting MatchQueueItems');
    MatchQueueItem.find({cached: true},
        function(error, mqi) {
        console.log('[INFO] MatchQueueItems loaded');
        if (error) {
            console.log(error);
        } else if (mqi.length) {
            // Do this synchronously so that we don't end up modifying the same record
            async.eachSeries(mqi, function(mqi_entry, next_mqi){
                MatchProcessed.findOne({_id: mqi_entry._id}, function(error, mp){
                    if (error) {
                        console.log(error);
                    } else {
                        if (!mp) {
                            MatchCacheItem.findOne({ _id: mqi_entry._id, 'data.matchVersion': /^5.19/ }, function(error, mci) {
                                if (error) {
                                    console.log(error);
                                } else if (mci) {
                                    if (mci.data) {
                                        processFrames(mci.data, mqi_entry.tier, next_mqi);
                                    } else {
                                        console.log("[ERROR] MatchCacheItem's data is null: "+mqi_entry._id);
                                        next_mqi();
                                    }
                                } else {
                                    next_mqi();
                                }
                            });
                        } else {
                            // Already processed this match
                            next_mqi();
                        }
                    }
                });
            }, function(){ console.log('[FINISHED]'); setTimeout( function(){ selectMatch(); }, 60000 ) });
        } else {
            console.log('[ERROR] No MatchQueueItems ready to be processed');
        }
    }).sort({timestamp: -1});
}

selectMatch();