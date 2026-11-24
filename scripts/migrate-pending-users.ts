import "dotenv/config";
import mongoose from "mongoose";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  try {
    const users = mongoose.connection.collection("users");
    const indexes = await users.indexes();
    const mobileIndex = indexes.find(index =>
      index.key.mobile === 1 && Object.keys(index.key).length === 1
    );
    if (mobileIndex && !mobileIndex.sparse) {
      await users.dropIndex(mobileIndex.name!);
    }
    await users.createIndex({ mobile: 1 }, { unique: true, sparse: true });
    console.log("Mobile index now allows accounts without a mobile number.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
