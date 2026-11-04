import { i18n } from "./i18n.js";

// Название главы для мест вне Рукописи (привязка карточки Холста и
// Доски, «Знания», поиск): пока книга одна — как было, просто название;
// когда книг несколько — с книгой впереди, иначе две «Главы 1» из
// разных книг не различить (manuscript.books, см. manuscript.js).
export function chapterLabel(ch, books) {
  const title = ch?.title || i18n("Без названия");
  if (!Array.isArray(books) || books.length < 2) return title;
  const book = books.find((b) => b.id === ch.bookId) || books[0];
  return `${book.title || i18n("Без названия")} · ${title}`;
}
