export function errorHandler(error, req, res, next) {
  console.error(error);
  return res.status(error.status || 500).json({
    error: error.message || 'Erro interno no servidor',
  });
}
