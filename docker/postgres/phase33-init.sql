CREATE DATABASE swisstalenthub_test OWNER swisstalenthub;
CREATE DATABASE swisstalenthub_upgrade OWNER swisstalenthub;
CREATE DATABASE swisstalenthub_upgrade_test OWNER swisstalenthub;
CREATE DATABASE swisstalenthub_contract_test OWNER swisstalenthub;

ALTER DATABASE swisstalenthub SET statement_timeout = '5s';
ALTER DATABASE swisstalenthub SET idle_in_transaction_session_timeout = '5s';
ALTER DATABASE swisstalenthub_test SET statement_timeout = '5s';
ALTER DATABASE swisstalenthub_test SET idle_in_transaction_session_timeout = '5s';
ALTER DATABASE swisstalenthub_upgrade SET statement_timeout = '5s';
ALTER DATABASE swisstalenthub_upgrade SET idle_in_transaction_session_timeout = '5s';
ALTER DATABASE swisstalenthub_upgrade_test SET statement_timeout = '5s';
ALTER DATABASE swisstalenthub_upgrade_test SET idle_in_transaction_session_timeout = '5s';
ALTER DATABASE swisstalenthub_contract_test SET statement_timeout = '5s';
ALTER DATABASE swisstalenthub_contract_test SET idle_in_transaction_session_timeout = '5s';
