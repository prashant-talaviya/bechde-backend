import mongoose from 'mongoose';
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function objectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new HttpError(400, 'Invalid ID.');
  return value.toLowerCase();
}
export function pageNumber(value: unknown): number {
  const page = Number(value || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new HttpError(400, 'Invalid page.');
  return page;
}
export function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function searchText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
}
export const duplicateKey = (error: unknown) => (error as mongoose.mongo.MongoServerError)?.code === 11000;
