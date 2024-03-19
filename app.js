const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

const databasePath = path.join(__dirname, "twitterClone.db");

app.use(express.json());

let database = null;

const initializeDBAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => console.log("https://localhost:3000/"));
  } catch (e) {
    console.log(`Database Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//API 1: register

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const getUser = await database.get(
    `SELECT * FROM user WHERE username = '${username}'`
  );
  if (getUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 12);
      const postUserQuery = `INSERT INTO user (username, name, password, gender)
            VALUES ('${username}', '${name}', '${hashedPassword}','${gender}')`;
      await database.get(postUserQuery);
      response.send("User created successfully");
    }
  }
});

//API 2: login

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const getUser = await database.get(
    `SELECT * FROM user WHERE username = '${username}'`
  );

  if (getUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const checkPassword = await bcrypt.compare(password, getUser.password);
    if (checkPassword == true) {
      const payload = {
        username: username,
        password: password,
      };
      const token = jwt.sign(payload, "MY_Secret_key");
      response.status(200);
      response.send({ jwtToken: token });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Authorization with JWT token

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_Secret_key", async (error, payLoad) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.headers.username = payLoad.username;
        next();
      }
    });
  }
};

const isUserFollowing = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request.headers;

  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  const userId = user["user_id"];

  const followingQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = '${userId}';`;

  const userFollowingData = await database.all(followingQuery);

  const tweetUserId = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`;
  const tweetData = await database.get(tweetUserId);
  // response.send(tweetData["user_id"]);

  let isTweetFollowed = false;
  userFollowingData.forEach((each) => {
    if (each["following_user_id"] === tweetData["user_id"]) {
      isTweetFollowed = true;
    }
  });

  if (isTweetFollowed) {
    next();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
};

//API 3: feed

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  const userId = user["user_id"];

  const getTweetsQuery = `
    SELECT username, tweet, date_time As dateTime
    FROM follower INNER JOIN tweet
    ON follower.following_user_id = tweet.user_id
    NATURAL JOIN user
    WHERE follower.follower_user_id = '${userId}'
    ORDER BY dateTime DESC
    LIMIT 4`;

  const data = await database.all(getTweetsQuery);
  response.send(data);
});

// API 4: list of names people follow

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  const userId = user["user_id"];

  const query = `
    SELECT name from user inner JOIN follower on user.user_id = follower.following_user_id WHERE '${userId}' = follower_user_id`;

  const data = await database.all(query);
  response.send(data);
});

// API 5: list of peoples follows user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  const userId = user["user_id"];

  const query = `SELECT name from user inner JOIN follower on user.user_id = follower.follower_user_id WHERE '${userId}' = following_user_id`;

  const data = await database.all(query);
  response.send(data);
});

// API 6: return tweet info if user follower tweet owner

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const query = `SELECT tweet, COUNT(like_id) AS likes, COUNT(DISTINCT reply_id)  AS replies, date_time AS dateTime FROM tweet INNER JOIN like on tweet.tweet_id = like.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id WHERE tweet.tweet_id = '${tweetId}'`;

    const data = await database.get(query);
    response.send(data);
  }
);

// API 7: list of users who liked

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const query = `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE like.tweet_id = '${tweetId}'`;

    const data = await database.all(query);
    const userNameArray = data.map((each) => each.username);
    response.send({ likes: userNameArray });
  }
);

// API 8: list of tweet replies

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const query = `SELECT name, reply FROM reply INNER JOIN user ON user.user_id = reply.user_id WHERE tweet_id = '${tweetId}'`;
    const data = await database.all(query);

    response.send({ replies: data });
  }
);

// API 9: list of all tweets of user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  const userId = user["user_id"];

  const query = `SELECT tweet, COUNT(like_id) AS likes, COUNT(DISTINCT reply)  AS replies, date_time AS dateTime FROM tweet INNER JOIN like on tweet.tweet_id = like.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id WHERE tweet.user_id = '${userId}' GROUP BY tweet.tweet_id;`;
  const data = await database.all(query);

  response.send(data);
});

// API 10: post a tweet

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request.headers;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  const userId = user["user_id"];

  const query = `INSERT INTO tweet(tweet, user_id) VALUES ('${tweet}', '${userId}')`;
  await database.run(query);
  response.send("Created a Tweet");
});

// API 11: delete a tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request.headers;
    const { tweetId } = request.params;
    const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
    const user = await database.get(getUserQuery);
    const userId = user["user_id"];

    const userTweetsQuery = `SELECT user_id, tweet_id FROM tweet WHERE user_id = '${userId}';`;
    const userTweetsData = await database.all(userTweetsQuery);

    let isTweetUser = false;
    userTweetsData.forEach((each) => {
      if (each["tweet_id"] == tweetId) {
        isTweetUser = true;
      }
    });

    if (isTweetUser) {
      const query = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
      await database.run(query);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
