# Project
 
We want to read the messages from Whatsapp and place the messages on different kafka topic based on event received from Whatsapp through Bailerys. Specifically:
1.1 all messages from a named group that begin with the keyword score are placed on score topic with a datatime stamp
1.2. all messages from a named group that belong to a poll are placed on a poll topic
This service will be called the Whatsapp-message-Monitor. 
It will use a linked account to obtain access to whatapp.

# Build

a dockerfile will be created to create an image of hatsapp-message-Monitor.

# messages on queue
1. poll messages must contain the poll id, the description of the poll and the name of the person who voted

# Environment
1. this will run locally on kubernetes
2. a helm chart will be created to deploy this project on kubernetes
3. the Kafka cluster will have 1 broker 
4. the kafka cluster will have 1 zookeeper
5. persistent volume claim will be created to store the credentials. So the credentials can be reused when the code is starterd (this is just for testing the prototype)
6. there will be a postgress database to store the messages. It will store its data in a persistant claim. Its ports must be accessible from the test environemtn
7. there will be one pod holding hatsapp-message-Monitor.



