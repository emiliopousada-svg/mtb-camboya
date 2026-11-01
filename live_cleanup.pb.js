// Borra del servidor las posiciones en vivo que llevan más de 5 minutos sin actualizarse.
// Evita que el último punto de alguien (con la app cerrada o sin cobertura) quede guardado y consultable.
// Se ejecuta cada minuto.
cronAdd("limpiar_live_locations", "* * * * *", () => {
  const limite = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace("T", " ");
  $app.db()
    .newQuery("DELETE FROM live_locations WHERE updated < {:limite}")
    .bind({ limite: limite })
    .execute();
});
