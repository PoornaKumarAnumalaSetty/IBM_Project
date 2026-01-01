import database, { pool } from './database.js';

export const query = (text, params = []) => pool.query(text, params);

export { pool };
export default {
    pool,
    query,
    database
};

