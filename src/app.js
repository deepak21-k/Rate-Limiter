require("dotenv").config();
const express = require("express");
const routes  = require("./routes");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Trust proxy headers (needed for correct req.ip behind reverse proxy)
app.set("trust proxy", 1);

// Mount all routes
app.use("/", routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Rate Limiter running on http://localhost:${PORT}`);
  });
}

module.exports = app; // exported for testing
