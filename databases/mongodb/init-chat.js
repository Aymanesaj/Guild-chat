// Executed by the official MongoDB image when /data/db is first initialized.
const username = process.env.CHAT_MONGO_USER;
const password = process.env.CHAT_MONGO_PASSWORD;
const database = process.env.CHAT_MONGO_DB || "chatdb";
const authDatabase = process.env.CHAT_MONGO_AUTH_DB || "admin";

if (!username || !password) {
  throw new Error("CHAT_MONGO_USER and CHAT_MONGO_PASSWORD are required");
}

// Older environments use the root account for chat. Preserve that account.
if (authDatabase === "admin" && username === process.env.MONGO_INITDB_ROOT_USERNAME
    && password !== process.env.MONGO_INITDB_ROOT_PASSWORD) {
  throw new Error("Chat and root passwords must match when they use the same MongoDB account");
}

const authDb = db.getSiblingDB(authDatabase);
if (authDb.getUser(username)) {
  print("Configured chat user already exists; credentials and roles unchanged.");
} else {
  authDb.createUser({
    user: username,
    pwd: password,
    roles: [{ role: "readWrite", db: database }],
  });
  print("Created chat user with readWrite access to its database.");
}
