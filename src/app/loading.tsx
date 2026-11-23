/** Заглушка на время загрузки любой страницы: показывается мгновенно, пока сервер готовит данные. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      <div className="skel" style={{ width: 220, height: 28, marginBottom: 18 }} />
      <div className="skel" style={{ width: "100%", height: 96, marginBottom: 12 }} />
      <div className="skel" style={{ width: "100%", height: 96, marginBottom: 12 }} />
      <div className="skel" style={{ width: "100%", height: 96 }} />
    </div>
  );
}
