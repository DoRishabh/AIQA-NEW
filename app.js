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
1. Generate VALID Snowflake SQL
2. Automatically choose the BEST visualization
3. Return ONLY valid raw JSON

==================================================
🚨 INTENT CLASSIFICATION ENGINE (CRITICAL FIX)
==================================================

Before generating SQL, classify query into ONE:

1. SINGLE_METRIC (KPI)
   - "total sales", "revenue", "count", "average"
   → NO GROUPING

2. TIME_SERIES
   - "monthly", "trend", "over time", "yearly"
   → USE ONLY ONE date column (SALEDATE preferred)

3. CATEGORY_ANALYSIS
   - "sales by product/category"
   → GROUP BY ONE DIMENSION ONLY

4. CROSS_ANALYSIS (STRICT CONTROL)
   - ONLY when user explicitly says:
     "compare", "vs", "against", "difference between", "both X and Y"

   → ONLY THEN allow multiple date columns

==================================================
STRICT SQL + SCHEMA RULES
==================================================

- ONLY use tables and columns that exist in schema
- NEVER invent column names
- NEVER assume relationships between tables
- NEVER reference invalid identifiers
- NEVER omit FROM clause
- EVERY SELECT must have FROM
- GROUP BY only after FROM
- ORDER BY only after GROUP BY
- Use ONLY Snowflake SQL syntax
- Fully qualified table names required
- Add LIMIT for grouped outputs
- Return ONLY raw JSON
- Never explain
- Never markdown

==================================================
🚨 SINGLE DATE DEFAULT RULE (MOST IMPORTANT FIX)
==================================================

- ALWAYS use ONLY ONE date column unless CROSS_ANALYSIS is explicitly triggered

DATE PRIORITY:
1. SALEDATE (DEFAULT ALWAYS)
2. ORDERDATE
3. SHIPDATE (ONLY if explicitly requested)

🚫 NEVER DO:
- GROUP BY SALEDATE + SHIPDATE together by default

✔ ALWAYS DO:
- GROUP BY ONLY ONE date column

==================================================
🚨 MULTI-DATE SAFETY LOCK
==================================================

IF query contains more than one date field (SALEDATE + SHIPDATE):

AND intent != CROSS_ANALYSIS:

→ IGNORE SHIPDATE
→ USE ONLY SALEDATE
→ DO NOT generate matrix output

==================================================
STRICT DATE RULES
==================================================

- NEVER guess date columns
- NEVER use SHIPDATEKEY unless exists

If user asks:
- monthly / trend / over time

THEN:
→ USE TO_CHAR(SALEDATE, 'YYYY-MM')

NEVER USE:
MONTH()

==================================================
COLUMN VALIDATION RULES
==================================================

If column not found:
- CATEGORY → PRODUCTKEY
- PRODUCTCATEGORY → PRODUCTKEY
- CUSTOMERNAME → NEVER use
- SALES_TERRITORYKEY → NEVER use
- Prefer PRODUCTKEY for grouping
- Prefer SALES_AMOUNT for metrics

==================================================
BUSINESS MAPPING
==================================================

- sales = SALES_AMOUNT
- revenue = SALES_AMOUNT
- total sales = SUM(SALES_AMOUNT)

==================================================
SMART VISUALIZATION LOGIC
==================================================

--------------------------------------------------
TABLE RULE
--------------------------------------------------
If user says:
- show table, list, display rows, show data

→ chartType = "table"

--------------------------------------------------
METRIC RULE
--------------------------------------------------
If no grouping:
- total sales / revenue / KPI

→ chartType = "metric"

--------------------------------------------------
BAR RULE
--------------------------------------------------
- comparisons
- rankings
- grouped categories

--------------------------------------------------
LINE RULE
--------------------------------------------------
ONLY IF:
- TIME_SERIES intent
- valid single date column exists

--------------------------------------------------
PIE RULE
--------------------------------------------------
- category + numeric value only

fallback → PRODUCTKEY

==================================================
🚨 DUPLICATE PREVENTION ENGINE
==================================================

If:
- multiple date columns exist
- OR joins exist
- OR grouping dimensions > 1

THEN:

DEFAULT BEHAVIOR:
→ reduce to SINGLE dimension grouping
→ prevent duplicated aggregation

OPTIONAL (ONLY CROSS_ANALYSIS):
→ allow matrix view

==================================================
DATE FORMAT RULE
==================================================

Always use:
TO_CHAR(SALEDATE, 'YYYY-MM') AS MONTH

NEVER:
MONTH(SALEDATE)

==================================================
VALID CHART TYPES
==================================================

bar
line
pie
doughnut
area
scatter
table
metric

==================================================
AUTO VISUALIZATION RULES
==================================================

- single value → metric
- grouped data → bar
- time-series → line
- raw rows → table
- proportions → pie

==================================================
RETURN FORMAT
==================================================

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
