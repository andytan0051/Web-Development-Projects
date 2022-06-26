const express = require("express");
var pg = require("pg");
const dotenv = require("dotenv");
var session = require("express-session");
const {urlencoded} = require("express");
const axios = require("axios");

/* Reading global variables from config file */
dotenv.config();
const PORT = process.env.PORT;


const conString = process.env.DB_CON_STRING;

if (conString == undefined) {
    console.log("ERROR: environment variable DB_CON_STRING not set.");
    process.exit(1);
}

const dbConfig = {
    connectionString: conString,
    ssl: { rejectUnauthorized: false }
}

var dbClient = new pg.Client(dbConfig);
dbClient.connect();

/*
 *
 * Express setup
 *
*/

app = express();

//turn on serving static files (required for delivering css to client)
app.use(express.static("public"));
//configure template engine
app.set("views", "views");
app.set("view engine", "pug");

app.use(session({
    secret: "This is a secret!",
    cookie: { maxAge: 3600000 },
    resave: true,
    saveUninitialized: true
}));

app.get('/', (req, res) => {
    res.render("index");
});

app.post("/", urlencoded({ extended: false }), function(req,res){
    var email = req.body.email;
    var password = req.body.password;

    dbClient.query("SELECT * FROM users WHERE email=$1 AND password=$2", [email, password], async function (dbError, dbResponse) {
        if (dbResponse.rows.length === 0) {
            res.render("index", {login_error: true});
        }
        else {
            req.session.user_id = dbResponse.rows[0].id;
            res.redirect("stations");
        }
    });

});

app.get('/stations', async(req, res) => {

    if(req.session.user_id == undefined){
        res.render("index", {login_error: true});
    }

    req.session.readingArray = [];
    var markerScript = "";
    let station_id_index = await dbClient.query("SELECT id FROM stations where user_id = $1", [req.session.user_id]);

    for (let index = 0; index < station_id_index.rows.length; index++) {
        let stations = await dbClient.query("SELECT * FROM stations JOIN readings ON stations.id = readings.station_id WHERE station_id=$1", [station_id_index.rows[index].id]);
        stations.rows[stations.rows.length - 1].direction = getTextfromDegrees(stations.rows[stations.rows.length - 1].direction);
        req.session.readingArray.push(stations.rows[stations.rows.length - 1]);
        markerScript += 'var marker = L.marker([' + stations.rows[stations.rows.length - 1].latitude + ',' + stations.rows[stations.rows.length - 1].longitude + `]).addTo(map).bindPopup('<a href=\"/stations/` + stations.rows[stations.rows.length - 1].station_id + `\">` + stations.rows[stations.rows.length - 1].station + `</a>');`;

    }

    res.render("dashboard", {
        latestreadings: req.session.readingArray,
        markerScript : markerScript
    });

});

app.post("/stations", urlencoded({ extended: false }), function(req,res){

    //insert station
    var stationname = req.body.station_name;
    var xposition = req.body.xposition;
    var yposition = req.body.yposition;

    //delete station
    var stationid_tobeDeleted = req.body.stationid;

    if(stationid_tobeDeleted != undefined){
        dbClient.query("DELETE FROM readings WHERE station_id = $1", [stationid_tobeDeleted]);
        dbClient.query("DELETE FROM stations WHERE id = $1", [stationid_tobeDeleted]);
    }

    else {
        dbClient.query("INSERT INTO stations (station, latitude, longitude, user_id) VALUES ($1, $2, $3, $4)", [stationname, xposition, yposition, req.session.user_id]); //kann man function(dbError,...) weglassen

        dbClient.query("SELECT * FROM stations ORDER BY id DESC LIMIT 1", function (dbError, dbResponse) {
            var max_station_id = dbResponse.rows[0].id;
            dbClient.query("INSERT INTO readings (station_id, user_id) VALUES ($1, $2)", [max_station_id, req.session.user_id]);

        });
    }


    res.redirect("/stations");

});

app.get("/stations/:id", async function (req, res) {

    if(req.session.user_id == undefined){
        res.render("index", {login_error: true});
    }

    /* List details about a station */
    var stationId = req.params.id;
    let readings_method = await dbClient.query("SELECT * FROM stations JOIN readings ON stations.id = readings.station_id WHERE station_id=$1", [stationId]);
    readings_method.rows[readings_method.rows.length -1].direction = getTextfromDegrees(readings_method.rows[readings_method.rows.length -1].direction);
    let readingswithSortedId = await dbClient.query("SELECT * FROM readings WHERE station_id=$1 ORDER BY id", [stationId]);
    res.render("details", {
        latest_reading: readings_method.rows[readings_method.rows.length -1],
        readings: readingswithSortedId.rows.reverse()
    });


});

app.post("/stations/:id", urlencoded({ extended: false }), async function(req,res) {

    var stationId = req.params.id;
    let readings = await dbClient.query("SELECT * from readings where station_id = $1", [stationId]);

    //insert reading
    var weatherCode = req.body.weather_code;
    var temp = req.body.temperature;
    var windSpeed = req.body.wind_speed;
    var windDirection = req.body.wind_direction;
    var airPressure = req.body.airpressure;
    //delete reading
    var reading_tobeDeleted = req.body.readingid;

    if (reading_tobeDeleted != undefined) {
        if (readings.rows.length == 1) {
           dbClient.query("UPDATE readings SET weather = null, temperature = null, wind = null, direction = null, pressure = null WHERE id = $1", [reading_tobeDeleted]);
           dbClient.query("UPDATE stations SET temp_increase = null, wind_increase = null, pressure_increase = null WHERE id = $1", [stationId]);
        } else {
            dbClient.query("DELETE FROM readings WHERE id = $1", [reading_tobeDeleted]);
        }

    }

    else {
        var currentdate = new Date().toString();

        if (readings.rows.length == 1 && readings.rows[0].weather == null && readings.rows[0].temperature == null && readings.rows[0].wind == null && readings.rows[0].pressure == null) {
            dbClient.query("UPDATE readings SET time = $1, weather = $2, temperature = $3, wind = $4, direction = $5, pressure = $6, user_id = $7 WHERE station_id = $8", [currentdate, weatherCode, temp, windSpeed, windDirection, airPressure, req.session.user_id, stationId]);
        }
        else {
            dbClient.query("INSERT into readings (time, station_id, weather, temperature, wind, direction, pressure, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [currentdate, stationId, weatherCode, temp, windSpeed, windDirection, airPressure, req.session.user_id]);
        }


    }

    await updateReadings(stationId);

    res.redirect("/stations/"+stationId);

});


app.get("/register", function (req, res) {

    res.render("register");

});


app.post("/register", urlencoded({ extended: false }), async function(req,res){
    var email = req.body.email;
    var firstname = req.body.firstname;
    var lastname = req.body.lastname;
    var password = req.body.password;

    //check database if the email address already exists
    let checkExistingUser = await dbClient.query("SELECT * from users where email = $1", [email]);
    if (checkExistingUser.rows.length == 0) {
        dbClient.query("INSERT into users (email, firstname, lastname, password) VALUES ($1, $2, $3, $4)", [email, firstname, lastname, password]);
        res.render("index");
    }
    else{
        res.render("register",{register_error : true});
    }
});

app.get("/logout", function(req, res) {
    req.session.destroy(function (err) {
        console.log("Session destroyed.");
   });
    res.render("index");
});

app.get("/stations/:id/addreport", async function(req, res){

    var stationId = req.params.id;
    let readings = await dbClient.query("SELECT * FROM stations JOIN readings ON stations.id = readings.station_id WHERE station_id=$1", [stationId]);
    let report = await addreport(readings.rows[0].latitude, readings.rows[0].longitude);


    var currentdate = new Date().toString();
    if (readings.rows.length == 1 && readings.rows[0].weather == null && readings.rows[0].temperature == null && readings.rows[0].wind == null && readings.rows[0].pressure == null) {
        dbClient.query("UPDATE readings SET time = $1, weather = $2, temperature = $3, wind = $4, direction = $5, pressure = $6, user_id = $7 WHERE station_id = $8", [currentdate, report.code, report.temperature, report.windSpeed, report.windDirection, report.pressure, req.session.user_id, stationId]);
    }
    else {
        dbClient.query("INSERT into readings (time, station_id, weather, temperature, wind, direction, pressure, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [currentdate, stationId, report.code, report.temperature, report.windSpeed, report.windDirection, report.pressure, req.session.user_id]);
    }

    await updateReadings(stationId);

    res.redirect("/stations/"+stationId);
});


//Controller
async function addreport(latitude, longitude){
    const oneCallRequest = `https://api.openweathermap.org/data/2.5/onecall?lat=${latitude}&lon=${longitude}&units=metric&appid=ffb05f71a6c968a89b77bb6fc74a6bba`

    console.log("rendering new report");
    let report = {};
    const result = await axios.get(oneCallRequest);
    if (result.status == 200) {
        const reading = result.data.current;
        report.code = reading.weather[0].id;
        report.temperature = reading.temp;
        report.windSpeed = reading.wind_speed;
        report.pressure = reading.pressure;
        report.windDirection = reading.wind_deg;
    }

    return report;
}


async function updateReadings(stationId){

    //Maximum and Minimum of Temperature, Wind, Air Pressure
    let max_temp = await dbClient.query("SELECT MAX(temperature) FROM readings WHERE station_id=$1", [stationId]);
    let min_temp = await dbClient.query("SELECT MIN(temperature) FROM readings WHERE station_id=$1", [stationId]);
    let max_wind = await dbClient.query("SELECT MAX(wind) FROM readings WHERE station_id=$1", [stationId]);
    let min_wind = await dbClient.query("SELECT MIN(wind) FROM readings WHERE station_id=$1", [stationId]);
    let max_pressure = await dbClient.query("SELECT MAX(pressure) FROM readings WHERE station_id=$1", [stationId]);
    let min_pressure = await dbClient.query("SELECT MIN(pressure) FROM readings WHERE station_id=$1", [stationId]);
    dbClient.query("UPDATE stations SET max_temp = $1 WHERE id = $2", [max_temp.rows[0].max, stationId]);
    dbClient.query("UPDATE stations SET min_temp = $1 WHERE id = $2", [min_temp.rows[0].min, stationId]);
    dbClient.query("UPDATE stations SET max_wind = $1 WHERE id = $2", [max_wind.rows[0].max, stationId]);
    dbClient.query("UPDATE stations SET min_wind = $1 WHERE id = $2", [min_wind.rows[0].min, stationId]);
    dbClient.query("UPDATE stations SET max_wind = $1 WHERE id = $2", [max_wind.rows[0].max, stationId]);
    dbClient.query("UPDATE stations SET min_wind = $1 WHERE id = $2", [min_wind.rows[0].min, stationId]);
    dbClient.query("UPDATE stations SET max_pressure = $1 WHERE id = $2", [max_pressure.rows[0].max, stationId]);
    dbClient.query("UPDATE stations SET min_pressure = $1 WHERE id = $2", [min_pressure.rows[0].min, stationId]);

    //Increasing or Decreasing Trend of Temperature, Wind, Air Pressure
    let updatedreadings = await dbClient.query("SELECT * from readings where station_id = $1 ORDER BY id", [stationId]);
    if(updatedreadings.rows.length > 1) {
        //Temperature
        if (updatedreadings.rows[updatedreadings.rows.length - 1].temperature > updatedreadings.rows[updatedreadings.rows.length - 2].temperature) {
            dbClient.query("UPDATE stations SET temp_increase = true WHERE id = $1", [stationId]);
        }
        else if (updatedreadings.rows[updatedreadings.rows.length - 1].temperature == updatedreadings.rows[updatedreadings.rows.length - 2].temperature){
            dbClient.query("UPDATE stations SET temp_increase = null WHERE id = $1", [stationId]);
        }
        else {
            dbClient.query("UPDATE stations SET temp_increase = false WHERE id = $1", [stationId]);
        }
        //Wind
        if (updatedreadings.rows[updatedreadings.rows.length - 1].wind > updatedreadings.rows[updatedreadings.rows.length - 2].wind) {
            dbClient.query("UPDATE stations SET wind_increase = true WHERE id = $1", [stationId]);
        }
        else if (updatedreadings.rows[updatedreadings.rows.length - 1].wind == updatedreadings.rows[updatedreadings.rows.length - 2].wind){
            dbClient.query("UPDATE stations SET wind_increase = null WHERE id = $1", [stationId]);
        }
        else {
            dbClient.query("UPDATE stations SET wind_increase = false WHERE id = $1", [stationId]);
        }
        //Pressure
        if (updatedreadings.rows[updatedreadings.rows.length - 1].pressure > updatedreadings.rows[updatedreadings.rows.length - 2].pressure) {
            dbClient.query("UPDATE stations SET pressure_increase = true WHERE id = $1", [stationId]);
        }
        else if (updatedreadings.rows[updatedreadings.rows.length - 1].pressure == updatedreadings.rows[updatedreadings.rows.length - 2].pressure){
            dbClient.query("UPDATE stations SET pressure_increase = null WHERE id = $1", [stationId]);
        }
        else {
            dbClient.query("UPDATE stations SET pressure_increase = false WHERE id = $1", [stationId]);
        }
    }
}

function getTextfromDegrees(direction){

    if(direction >= 0.0 && direction <= 360.0)
        if(direction > 348.75 || direction <= 11.25)
            return "Nord"
        else if(direction > 11.25 && direction <= 33.75)
            return "Nord Nord Ost"
        else if(direction > 33.75 && direction <= 56.25)
            return "Nord Ost"
        else if(direction > 56.25 && direction <= 78.75)
            return "Ost Nord Ost"
        else if(direction > 78.75 && direction <= 101.25)
            return "Ost"
        else if(direction > 101.25 && direction <= 123.75)
            return "Ost Süd Ost"
        else if(direction > 123.75 && direction <= 146.25)
            return "Süd Ost"
        else if(direction > 146.25 && direction <= 168.75)
            return "Süd Süd Ost"
        else if(direction > 168.75 && direction <= 191.25)
            return "Süd"
        else if(direction > 191.25 && direction <= 213.75)
            return "Süd Süd West"
        else if(direction > 213.75 && direction <= 236.25)
            return "Süd West"
        else if(direction > 236.25 && direction <= 258.75)
            return "West Süd West"
        else if(direction > 258.75 && direction <= 281.25)
            return "West"
        else if(direction > 281.25 && direction <= 303.75)
            return "West Nord West"
        else if(direction > 303.75 && direction <= 326.25)
            return "Nord West"
        else if(direction > 326.25 && direction <= 348.75)
            return "Nord Nord West"

}

app.listen(PORT, function() {
    console.log(`Weathertop running and listening on port ${PORT}`);
});