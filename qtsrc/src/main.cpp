#include "components/mainwindow.h"
#include <QApplication>
#include <QDebug>       // Include QDebug (and related headers)
#include <QTextStream>  // For QTextStream (recommended)
#include <cstdio> //for fprintf
#include "backend/communicationmanager.h" // Assuming this is where CommunicationManager is


void myMessageOutput(QtMsgType type, const QMessageLogContext &context, const QString &msg)
{
    QByteArray localMsg = msg.toLocal8Bit();
    QTextStream ts(stderr); // Use stderr for ALL messages

    switch (type) {
        case QtDebugMsg:
            ts << "Debug: " << localMsg << " (" << context.file << ":" << context.line << ", " << context.function << ")\n";
        break;
        case QtInfoMsg:
            ts << "Info: " << localMsg << " (" << context.file << ":" << context.line << ", " << context.function << ")\n";
        break;
        case QtWarningMsg:
            ts << "Warning: " << localMsg << " (" << context.file << ":" << context.line << ", " << context.function << ")\n";
        break;
        case QtCriticalMsg:
            ts << "Critical: " << localMsg << " (" << context.file << ":" << context.line << ", " << context.function << ")\n";
        break;
        case QtFatalMsg:
            ts << "Fatal: " << localMsg << " (" << context.file << ":" << context.line << ", " << context.function << ")\n";
        abort(); // IMPORTANT: Abort on fatal errors
    }
    ts.flush(); // Ensure immediate output
}

int main(int argc, char *argv[])
{
    qInstallMessageHandler(myMessageOutput); // Install the custom handler
    QApplication a(argc, argv);
    MainWindow w;
    w.show();
    return a.exec();
}