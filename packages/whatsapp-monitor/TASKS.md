# Things to do
1. Deal with transaction between What's app and Kafka. If Kafka is down the code needs to store the message somewhere so
2. that it can re send when the stream is back. At the moment, a error will result in a lost message. 
3. See if you can roll back message consumer through Bailey.js. Can it cache messages?