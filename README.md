NOTE : You need to run the ngrok a public link website first and then only run the "npm run dev"

Running the ngrok as follows :

.\ngrok config add-authtoken 2zRaug4eWH9gOifzzOTzd5xVQDR_2mzR5HmnEr3HHgzY5h1LN

.\ngrok http 3000

To run the project:

Just run the "npm run dev" in the Terminal.....

After Running the Command "npm run dev"

1. Go to the Browser and type "localhost:3000" in the search bar.
2. The Homepage will be Shown.
3. Now we can Signup and Login to the Application.
4. We can also see the Calendar Events and the Saved Posts.
5. We can also see the Profile Page.
6. We can also Logout from the Application.

To Connect to POSTGRES SQL Database

In Command Prompt :

Path for the Database : "C:\Program Files\PostgreSQL\17\bin>"

1. Run the command "psql -h localhost -U postgres -d instagram_generator"
2. Run the command "\dt" to view the tables in the database.
3. Run the command "\d name of the table" to view the data in the table.
   eg : \d users
   \d calendar_events
   \d saved_posts
4. Run the command "SELECT \* FROM users;" to view the data in the users table.(Right after running the Command \d users)
5. Run the command "SELECT \* FROM calendar_events" to view the data in the calendar_events table.(Right after running the Command \d calendar_events)
6. Run the command "SELECT \* FROM saved_posts" to view the data in the saved_posts table.(Right after running the Command \d saved_posts)
7. Run the command "\q" to exit the database.

NOTE : Sometimes the Database may directly give the data for the saved_posts because of error "ERROR: character with byte sequence 0xe2 0x98 0x95 in encoding "UTF8" has no equivalent in encoding "WIN1252"

then we need to run this Command " SET client_encoding = 'UTF8'; "

=> SELECT \* FROM saved_posts;

No Error will be Shown after Using the above Command.

If we want to export the deatils in the CSV, we can run the below commnads:

\COPY saved_posts TO 'C:/Users/YourUsername/saved_posts.csv' WITH (FORMAT csv, HEADER, ENCODING 'UTF8');
\COPY calendar_events TO 'C:/Users/YourUsername/calendar_events.csv' WITH (FORMAT csv, HEADER, ENCODING 'UTF8');
\COPY users TO 'C:/Users/YourUsername/users.csv' WITH (FORMAT csv, HEADER, ENCODING 'UTF8');

NOTE : You can change the Path as per your System.

Export All Tables Together:

pg_dump -h localhost -U postgres -d instagram_generator -F c -b -v -f "C:/instagram_generator_backup.backup"

NOTE : You can change the Path as per your System.
