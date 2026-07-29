function sendApiNotFound(_req, res) {
  return res.status(404).json({
    ok: false,
    error: "API route not found",
  });
}

module.exports = {
  sendApiNotFound,
};
