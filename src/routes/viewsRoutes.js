// Rutas de entrega de vistas HTML del sistema
const path = require('path');
const express = require('express');

const router = express.Router();

// Entrega del panel de administración
router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin.html'));
});

module.exports = router;
