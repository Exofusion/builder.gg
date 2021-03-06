var express = require('express');
var router = express.Router();

var models = require('../scripts/models');
var StatCollection = models.StatCollection;
var AggregateKDA = models.AggregateKDA;

router.get('/', function(req, res, next) {
    var combine_games = false;
    var search_options = {};

    if (req.query.championId) {
        search_options.championId = parseInt(req.query.championId);

        if (req.query.tier) {
            search_options.tier = parseInt(req.query.tier);
        }

        if (req.query.position) {
            switch(req.query.position) {
                case 'Top':
                    search_options.lane = 'TOP';
                    break;
                case 'Jungle':
                    search_options.lane = 'JUNGLE';
                    break;
                case 'Mid':
                    search_options.lane = 'MIDDLE';
                    break;
                case 'Bottom':
                    search_options.lane = 'BOTTOM';
                    break;
            }
            // switch case
        }

        if (req.query.patch) {
            search_options.patch = req.query.patch;
        }

        search_options.victory = true;

        // This could be changed to a simple find() without the 'victory' search option set, but we would
        // lose capability of finding the most popular lane and would still need multiple find() queries anyway

        // First try to find a victory
        StatCollection.findOne(search_options, function(error, victory_stat_collection) {
            if (error) {
                 console.log(error);
            } else {
                // If we find a stat_collection, populate search options with it
                if (victory_stat_collection) {
                    search_options = {};
                    search_options.patch = victory_stat_collection.patch;
                    search_options.championId = victory_stat_collection.championId;
                    search_options.tier = victory_stat_collection.tier;
                    search_options.lane = victory_stat_collection.lane;
                    search_options.role = victory_stat_collection.role;
                }
                search_options.victory = false;

                // Search for defeats now
                StatCollection.findOne(search_options, function(error, defeat_stat_collection) {
                    if (error) {
                         console.log(error);
                    } else if (!victory_stat_collection && !defeat_stat_collection) {
                        // Didn't find victories or defeats for search terms
                        res.status(404).end();
                    } else {
                        if (defeat_stat_collection) {
                            search_options = {};
                            search_options.patch = defeat_stat_collection.patch;
                            search_options.championId = defeat_stat_collection.championId;
                            search_options.tier = defeat_stat_collection.tier;
                            search_options.lane = defeat_stat_collection.lane;
                            search_options.role = defeat_stat_collection.role;
                        }

                        var response_stat_collection = {};
                        response_stat_collection.victories = victory_stat_collection;
                        response_stat_collection.defeats = defeat_stat_collection;

                        // Look up KDA aggregate stats
                        var victory_aggkda_search = {
                                                        '_id.patch': search_options.patch,
                                                        '_id.tier': search_options.tier,
                                                        '_id.lane': search_options.lane,
                                                        '_id.role': search_options.role,
                                                        '_id.victory': true
                                                    };
                        AggregateKDA.findOne(victory_aggkda_search, function(error, victory_aggregate_kda){
                            if (error) {
                                console.log(error);
                            } else {
                                response_stat_collection.victories_aggregate_kda = victory_aggregate_kda;
                                var defeat_aggkda_search = victory_aggkda_search;
                                defeat_aggkda_search['_id.victory'] = false

                                AggregateKDA.findOne(defeat_aggkda_search, function(error, defeat_aggregate_kda){
                                    response_stat_collection.defeats_aggregate_kda = defeat_aggregate_kda;
                                    res.send(response_stat_collection);
                                }).lean();
                            }
                        }).lean();
                    }
                }).lean();
            }
        }).lean().sort({samples: -1});
    } else {
        res.status(404).end();
    }
});

module.exports = router;
