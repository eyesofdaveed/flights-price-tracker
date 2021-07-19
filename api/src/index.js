const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { response } = require("express");
const { json } = require("body-parser");
const redis = require("redis");

const redisPort = 6379;
const redisClient = redis.createClient(6379, "127.0.0.1");

const app = express();
app.use(cors());

const port = process.env.PORT || 5000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const flightDirections = [
  ("ALA", "TSE"),
  ("TSE", "ALA"),
  ("ALA", "MOW"),
  ("MOW", "ALA"),
  ("ALA", "CIT"),
  ("CIT", "ALA"),
  ("TSE", "MOW"),
  ("MOW", "TSE"),
  ("TSE", "LED"),
  ("LED", "TSE"),
];

const BASE_URL = "https://api.skypicker.com/flights?flyFrom=ALA&to=TSE";
const AFFIL_ID = "&partner=eyesofdaveedaviatatest";
const additional_parameters = "&one_per_date=1&curr=KZT";
const CHECK_STATUS_URL =
  "https://booking-api.skypicker.com/api/v0.1/check_flights?";
const STATUS_CHECK_PARAMS = "&currency=KZT&bnum=1&pnum=1&v=2";

/* Update cache on noon of each day */
function updatePriceCache(getPricesForNextMonth) {
  (function loop() {
    var now = new Date();
    if (
      now.getDate() === 12 &&
      now.getHours() === 12 &&
      now.getMinutes() === 0
    ) {
      getPricesForNextMonth();
    }
    now = new Date();
    var delay = 60000 - (now % 60000); // exact ms to next minute interval
    setTimeout(loop, delay);
  })();
}

/* Sleep for ms secs */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Check validity of the flight, if not, recursively call the function with booking token again */
async function retrieve_actual_price_of_flight(booking_token) {
  let status_check_url =
    CHECK_STATUS_URL + STATUS_CHECK_PARAMS + `&booking_token=${booking_token}`;

  const check_promise = axios({
    method: "get",
    url: status_check_url,
    headers: {
      "Content-Type": "application/json",
    },
  }).then((response) => {
    if (response.data.flights_checked) {
      return response;
    } else {
      sleep(10000).then(() => {
        retrieve_actual_price_of_flight(booking_token);
      });
    }
  });
  return check_promise;
}

/* Get prices for a month ahead */
async function getPricesForNextMonth(req, res) {
  /* Clean up the cache before rewriting */
  redisClient.flushall();
  /* Figure out the numbers of days in a current month */
  var dt = new Date();
  var month = dt.getMonth() + 1;
  var year = dt.getFullYear();
  var daysInCurrentMonth = new Date(year, month, 0).getDate();

  /* Date to traverse */
  var dateOfToday = dt.getDate() + 1;
  var promises = [];
  var finalResult = [];

  /* Collect the information of flights for the next month */
  for (let currentDate = 0; currentDate < 30; currentDate++) {
    let DATE_URL = `&date_from=${dateOfToday.toString()}/${month.toString()}/${year.toString()}&date_to=${dateOfToday.toString()}/${month.toString()}/${year.toString()}`;
    let GET_URL = BASE_URL + DATE_URL + AFFIL_ID + additional_parameters;
    let price;
    let dateOfFLight;

    /* Update the month/year in case it goes for the next month/year */
    if (dateOfToday == daysInCurrentMonth) {
      dateOfToday = 1;
      if (month + 1 == 13) {
        month = 1;
        year += 1;
      } else {
        month += 1;
      }
    } else {
      dateOfToday += 1;
    }

    /* Create a list of promises and return the booking token for each promise */
    promises.push(
      axios.get(GET_URL).then((response) => {
        let booking_token_of_flight = response.data.data[0].booking_token;

        /* Keep checking the flight status untill true, and returns
        the actual flight total price */
        retrieve_actual_price_of_flight(booking_token_of_flight)
          .then((response) => {
            try {
              price = response.data.conversion.amount;
              dateOfFLight = response.data.flights[0].dtime;

              /* Push the actual checked price into the cahce data */
              redisClient.hmset("ALATSE", dateOfFLight, price);
              redisClient.hgetall("ALATSE", function (err, results) {
                if (err) {
                  console.log(error);
                } else {
                  console.log(results);
                }
              });
            } catch (error) {
              console.log(error);
            }
          })
          .catch((error) => {
            console.log(error);
          });
      })
    );
  }

  /* Send the final response coming from the cache */
  Promise.all(promises).then(() => {
    res.send(finalResult);
  });
}

/* Update cache on noon of each day */
updatePriceCache(getPricesForNextMonth);

app.get("/", getPricesForNextMonth);

// Listen on enviroment port or 5000
app.listen(port, () => console.log(`Listening on port ${port}`));
