require('dotenv').config();

const express = require('express');
const cors = require('cors');
const snowflake = require('snowflake-sdk');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const requiredEnvVars = [
    'GROQ_API_KEY',
    'GROQ_MODEL',
    'SNOWFLAKE_ACCOUNT',
    'SNOWFLAKE_USER',
    'SNOWFLAKE_PASSWORD',
    'SNOWFLAKE_DATABASE',
    'SNOWFLAKE_SCHEMA',
    'SNOWFLAKE_WAREHOUSE',
    'SNOWFLAKE_ROLE'
];

requiredEnvVars.forEach((key) => {
    if (!process.env[key]) {
        console.error(`❌ Missing environment variable: ${key}`);
    }
});

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const snowflakeConfig = {
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE
};

let snowflakeConnection = null;

async function getSnowflakeConnection() {

    return new Promise((resolve, reject) => {

        if (snowflakeConnection && snowflakeConnection.isUp()) {
            return resolve(snowflakeConnection);
        }

        const connection = snowflake.createConnection(snowflakeConfig);

        connection.connect((err, conn) => {

            if (err) {
                console.error('❌ Snowflake connection error:', err);
                reject(err);
            } else {
                console.log('✅ Connected to Snowflake successfully');
                snowflakeConnection = conn;
                resolve(conn);
            }
        });
    });
}

async function executeQuery(sqlText) {

    const connection = await getSnowflakeConnection();

    return new Promise((resolve, reject) => {

        connection.execute({

            sqlText,

            complete: (err, stmt, rows) => {

                if (err) {
                    console.error('❌ Query execution error:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            }
        });
    });
}

async function getDatabaseSchema() {

    try {

        const sql = `
            SELECT
                TABLE_NAME,
                COLUMN_NAME,
                DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '${process.env.SNOWFLAKE_SCHEMA}'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `;

        const tables = await executeQuery(sql);

        const schema = {};

        tables.forEach((row) => {

            if (!schema[row.TABLE_NAME]) {
                schema[row.TABLE_NAME] = [];
            }

            schema[row.TABLE_NAME].push({
                name: row.COLUMN_NAME,
                type: row.DATA_TYPE
            });
        });

        return schema;

    } catch (error) {

        console.error('❌ Error fetching schema:', error);
        return {};
    }
}

async function generateQueryAndChart(userQuery, schema) {

    const schemaDescription = Object.entries(schema)
        .map(([table, columns]) => {

            const cols = columns
                .map(col => `${col.name} (${col.type})`)
                .join(', ');

            return `Table: ${table}\nColumns: ${cols}`;

        })
        .join('\n\n');

    const systemPrompt = `
You are an expert Snowflake SQL developer and data visualization assistant.

DATABASE:
${process.env.SNOWFLAKE_DATABASE}

SCHEMA:
${process.env.SNOWFLAKE_SCHEMA}

AVAILABLE TABLES:
${schemaDescription}

YOUR TASK:
1. Generate valid Snowflake SQL
2. Suggest best chart type
3. Return ONLY valid JSON

IMPORTANT:
- Always use fully qualified table names
- Use Snowflake SQL syntax
- Add LIMIT where appropriate
- Never return markdown
- Never explain anything
- Never wrap JSON inside triple backticks

COMMON BUSINESS MAPPINGS:
- revenue = SALES_AMOUNT
- sales = SALES_AMOUNT
- total revenue = SUM(SALES_AMOUNT)
- total sales = SUM(SALES_AMOUNT)

VALID CHART TYPES:
bar, line, pie, doughnut, area, scatter, table, metric

RETURN FORMAT:
{
  "sql": "SELECT ...",
  "chartType": "bar",
  "chartConfig": {
    "title": "Chart Title",
    "xAxis": "x_column",
    "yAxis": "y_column",
    "labelField": "label_column",
    "valueField": "value_column",
    "description": "Description"
  }
}
`;

    try {

        const response = await groq.chat.completions.create({

            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",

            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userQuery
                }
            ],

            temperature: 0.1,
            max_tokens: 1024
        });

        let content = response.choices[0].message.content.trim();

        console.log('🤖 Raw AI Response:', content);

        content = content
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            throw new Error('No valid JSON found in AI response');
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.sql) {
            throw new Error('Generated SQL missing');
        }

        return parsed;

    } catch (error) {

        console.error('❌ Groq API Error:', error);
        throw error;
    }
}

app.get('/', (req, res) => {

    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', async (req, res) => {

    try {

        await getSnowflakeConnection();

        res.json({
            success: true,
            status: 'healthy',
            database: process.env.SNOWFLAKE_DATABASE,
            schema: process.env.SNOWFLAKE_SCHEMA
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error.message
        });
    }
});

app.get('/api/schema', async (req, res) => {

    try {

        const schema = await getDatabaseSchema();

        res.json({
            success: true,
            schema
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/query', async (req, res) => {

    try {

        const { query } = req.body;

        if (!query) {

            return res.status(400).json({
                success: false,
                error: 'Query is required'
            });
        }

        console.log('📥 User Query:', query);

        const schema = await getDatabaseSchema();

        const aiResponse = await generateQueryAndChart(query, schema);

        console.log('🧠 AI Response:', aiResponse);

        const data = await executeQuery(aiResponse.sql);

        console.log(`✅ Returned ${data.length} rows`);

        res.json({
            success: true,
            sql: aiResponse.sql,
            chartType: aiResponse.chartType || 'table',
            chartConfig: aiResponse.chartConfig || {},
            data
        });

    } catch (error) {

        console.error('❌ Query API Error:', error);

        res.status(500).json({
            success: false,
            error: error.message,
            details: error.toString()
        });
    }
});

app.post('/api/execute-sql', async (req, res) => {

    try {

        const { sql } = req.body;

        if (!sql) {

            return res.status(400).json({
                success: false,
                error: 'SQL is required'
            });
        }

        const data = await executeQuery(sql);

        res.json({
            success: true,
            data
        });

    } catch (error) {

        console.error('❌ SQL Execution Error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Dashboard available at http://localhost:${PORT}`);
});
