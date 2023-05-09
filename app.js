const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();
app.use(express.json());
let db = null;

const initializeDBAndServer = async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  app.listen(3000, () => {
    console.log("server is running at http://localhost:3000");
  });
};

initializeDBAndServer();
//API 1
app.post("/register/", async (request, response) => {
  const { username, password, gender, name } = request.body;
  const dbUser = await db.get(
    `Select * From user where username = "${username}";`
  );
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(`
                INSERT INTO user
                  (username,password, gender, name )
                values
                  ("${username}","${hashedPassword}","${gender}","${name}");`);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API 2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const dbUser = await db.get(
    `Select * From user where username = "${username}";`
  );
  if (dbUser !== undefined) {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatch) {
      let jwtToken = jwt.sign(username, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});
//
function authenticateToken(request, response, next) {
  let jwtToken;

  const authorization = request.headers["authorization"];
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
}

const response1 = (dbObject) => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
});

//API 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweets = await db.all(`
    SELECT
    tweet.tweet_id,
    tweet.user_id,
    user.username,
    tweet.tweet,
    tweet.date_time
    FROM
    follower
    LEFT JOIN tweet ON tweet.user_id = follower.following_user_id
    LEFT JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = (select user_id FROM user WHERE username = "${request.username}")
    ORDER BY tweet.date_time desc
    LIMIT 4;
  `);
  response.send(latestTweets.map((item) => response1(item)));
});

//API 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const following1 = await db.all(`
SELECT
user.name
FROM
follower
LEFT JOIN user ON follower.following_user_id = user.user_id
WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
`);
  response.send(following1);
});

//API 5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const followers1 = await db.all(`
SELECT
user.name
FROM
follower
LEFT JOIN user ON follower.follower_user_id = user.user_id
WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
`);
  response.send(followers1);
});

const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`
SELECT * FROM follower
WHERE
follower_user_id = (SELECT user_id FROM user WHERE username = "${request.username}")
AND
following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id = ${tweetId});
`);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API 6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(`
SELECT tweet,date_time FROM tweet WHERE tweet_id = ${tweetId};`);
    const { likes } = await db.get(`
SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = ${tweetId};`);
    const { replies } = await db.get(`
SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId};`);
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

//API-7

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedBy = await db.all(`
SELECT user.username FROM
LIKE NATURAL JOIN user
WHERE tweet_id = ${tweetId};
`);
    response.send({ likes: likedBy.map((item) => item.username) });
  }
);

//API-8

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const repliesQuery = `
SELECT user.name, reply.reply FROM
reply NATURAL JOIN user
WHERE tweet_id = ${tweetId};
`;
    const replies = await db.all(repliesQuery);
    //     const tweetReplies = await db.all(`
    // SELECT user.name, reply.reply FROM
    // reply NATURAL JOIN user
    // WHERE tweet_id = ${tweetId};
    // `);
    response.send({ replies });
  }
);

//API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const getTweets = await db.all(`
SELECT
tweet.tweet,
COUNT(distinct like.like_id) AS likes,
COUNT(distinct reply.reply_id) AS replies,
tweet.date_time
FROM
tweet
LEFT JOIN like ON tweet.tweet_id = like.tweet_id
LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = "${request.username}")
GROUP BY tweet.tweet_id;
`);
  response.send(
    getTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});

//API 10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `SELECT user_id FROM user WHERE username = "${request.username}"`
  );
  await db.run(`
INSERT INTO tweet
(tweet, user_id)
VALUES
("${tweet}",${user_id});
`);
  response.send("Created a Tweet");
});

//API 11

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweet = await db.get(`
SELECT
tweet_id, user_id
FROM
tweet
WHERE tweet_id = ${tweetId}
AND user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
`);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
DELETE FROM tweet
WHERE tweet_id = ${tweetId}
`);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
