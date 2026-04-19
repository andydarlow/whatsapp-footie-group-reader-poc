# Project
 
We want to read the messages from Whatsapp and place the messages on different kafka topic based on event received from Whatsapp through Bailerys. Specifically:
1.1 all messages from a named group that begin with the keyword score are placed on score topic with a datatime stamp
1.2. all messages from a named group that belong to a poll are placed on a poll topic
This service will be called the Whatsapp-message-Monitor. 
It will use a linked account to obtain access to whatapp.

# Quality
1. follow solid principles
2. No method should be longer than 30 lines
3. All methods should have a comment

# architecture
1. code in mono repo using npm workspaces
2. Four components:
	1. Whatsapp-message-Monitor (`packages/whatsapp-monitor`): reads messages from Whatsapp and places them on kafka topic. it will put the message on the score topic if it's a message with the word score on it, the poll topic if its related to a queue. 
    2. Match Poll consumer (`packages/match-poll-consumer`): reads poll about who wants to play in a match and stores the data in a db. This includes the history for the match (Poll) and the current state of which players are playing or not playing
	3. Team Admin command processor (`packages/team-admin-processor`): processes the commands received on an 'action' topic. This will return data on a separate topic called 'result'
3. Shared TypeScript config in `tsconfig.base.json` at root
4. Helm charts in `helm/` at root level

# Build

a dockerfile will be created for each package to create an image.

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
